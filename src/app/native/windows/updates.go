package windows

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"
	"wisewave/src/app/native/updates"
)

const updateInterval = 24 * time.Hour

type updatePreferences struct {
	AutomaticChecks    *bool     `json:"automaticChecks,omitempty"`
	AutomaticDownloads bool      `json:"automaticDownloads,omitempty"`
	SkippedVersion     string    `json:"skippedVersion,omitempty"`
	LastCheck          time.Time `json:"lastCheck,omitzero"`
}

type installerUpdates struct {
	busy      atomic.Bool
	pending   atomic.Pointer[string]
	checkMu   sync.Mutex
	checkedAt time.Time
	release   *updates.Release
}

func (*installerUpdates) enabled() bool {
	return runtime.GOOS == "windows" && (runtime.GOARCH == "amd64" || runtime.GOARCH == "arm64") && !mygo.IsDev() && mygo.App.Version() != ""
}

func (updater *installerUpdates) check() (*updates.Release, error) {
	updater.checkMu.Lock()
	defer updater.checkMu.Unlock()
	if time.Since(updater.checkedAt) < time.Minute {
		return updater.release, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	release, err := updates.Check(ctx, mygo.App.Version(), runtime.GOARCH)
	if err == nil {
		updater.checkedAt = time.Now()
		updater.release = release
	}
	return release, err
}

func updateStatePath() (string, error) {
	dir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "updater.json"), nil
}

func readUpdatePreferences() (prefs updatePreferences) {
	path, err := updateStatePath()
	if err != nil {
		return prefs
	}
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &prefs)
	}
	return prefs
}

func saveUpdatePreferences(prefs updatePreferences) error {
	path, err := updateStatePath()
	if err != nil {
		return err
	}
	data, err := json.Marshal(prefs)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".updater-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(data)
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), path)
}

func persistUpdatePreferences(prefs updatePreferences) {
	if err := saveUpdatePreferences(prefs); err != nil {
		log.Printf("save update preferences: %v", err)
	}
}

func updateCacheDirectory() (string, error) {
	dir, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "WiseWave", "update"), nil
}

func (updater *installerUpdates) start(window *mygo.Window) {
	if !updater.enabled() {
		return
	}
	if dir, err := updateCacheDirectory(); err == nil {
		files, _ := filepath.Glob(filepath.Join(dir, "wisewave-update-*.exe"))
		for _, file := range files {
			_ = os.Remove(file)
		}
	}
	time.Sleep(15 * time.Second)
	for {
		prefs := readUpdatePreferences()
		if prefs.AutomaticChecks != nil && !*prefs.AutomaticChecks {
			return
		}
		if elapsed := time.Since(prefs.LastCheck); elapsed >= 0 && elapsed < updateInterval {
			time.Sleep(updateInterval - elapsed)
			continue
		}
		updater.prompt(window, false)
		time.Sleep(updateInterval)
	}
}

func downloadInstaller(release *updates.Release) (string, error) {
	dir, err := updateCacheDirectory()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	file, err := os.CreateTemp(dir, "wisewave-update-*.exe")
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	downloadErr := release.Download(ctx, file)
	closeErr := file.Close()
	if downloadErr != nil || closeErr != nil {
		_ = os.Remove(file.Name())
		if downloadErr != nil {
			return "", downloadErr
		}
		return "", closeErr
	}
	return file.Name(), nil
}

func showUpdateError(window *mygo.Window, message string, err error) {
	log.Printf("update: %v", err)
	_, _ = mygo.Dialog.Message(mygo.MessageOptions{
		Parent: window, Type: mygo.MessageError, Title: "updates", Message: message, Buttons: []string{"ok"},
	})
}

func (updater *installerUpdates) prompt(window *mygo.Window, manual bool) {
	if !updater.enabled() || !updater.busy.CompareAndSwap(false, true) {
		return
	}
	defer updater.busy.Store(false)
	release, err := updater.check()
	if err != nil {
		if manual {
			showUpdateError(window, "couldn't check for updates", err)
		} else {
			log.Printf("update check: %v", err)
		}
		return
	}
	prefs := readUpdatePreferences()
	prefs.LastCheck = time.Now()
	persistUpdatePreferences(prefs)
	if release == nil || (!manual && release.Version == prefs.SkippedVersion) {
		return
	}

	var installer string
	if !manual && prefs.AutomaticDownloads {
		installer, err = downloadInstaller(release)
		if err != nil {
			log.Printf("download update: %v", err)
		}
	}
	defer func() {
		if installer != "" {
			_ = os.Remove(installer)
		}
	}()
	message := "wisewave " + release.Version + " is available"
	if installer != "" {
		message = "wisewave " + release.Version + " is ready to install"
	}
	result, err := mygo.Dialog.Message(mygo.MessageOptions{
		Parent: window, Type: mygo.MessageQuestion, Title: "updates", Message: message,
		Detail: release.Notes, Buttons: []string{"install update", "remind me later", "skip this version"},
		DefaultButton: 1, CancelButton: 1,
		CheckboxLabel: "download updates automatically", CheckboxChecked: prefs.AutomaticDownloads,
	})
	if err != nil {
		return
	}
	prefs.AutomaticDownloads = result.CheckboxChecked
	if result.Button == 2 {
		prefs.SkippedVersion = release.Version
	}
	persistUpdatePreferences(prefs)
	if result.Button != 0 {
		return
	}
	if installer == "" {
		installer, err = downloadInstaller(release)
		if err != nil {
			showUpdateError(window, "couldn't download the update", err)
			return
		}
	}
	pending := installer
	updater.pending.Store(&pending)
	installer = ""
	mygo.App.Quit()
}

func (updater *installerUpdates) launch() error {
	if installer := updater.pending.Swap(nil); installer != nil {
		command := exec.Command(*installer)
		if err := command.Start(); err != nil {
			return err
		}
		return command.Process.Release()
	}
	return nil
}
