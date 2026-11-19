package windows

import (
	"context"
	"errors"
	"log"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
	spotifyaccount "wisewave-runtime/desktop/accounts/Spotify"
	"wisewave-runtime/desktop/integrations"
	"wisewave-runtime/desktop/player"
	"wisewave/src/app/native/accounts/Spotify"
	"wisewave/src/app/native/accounts/YouTube"
	"wisewave/src/app/native/identity"
	"wisewave/src/app/native/system"
	"wisewave/src/app/native/tokens"
)

func Run(icon []byte) {
	identity.Init()
	mygo.App.SetName("WiseWave")
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	mygo.Use(updater.New(updater.Options{
		Icon:     icon,
		Language: "en",
		Strings: map[string]updater.Strings{"en": {
			Title: "updates", MenuItem: "check for updates", Checking: "checking for updates…",
			Cancel: "cancel", OK: "ok", UpToDate: "you're up to date",
			UpToDateMessage: "%s %s is the latest version",
			Unavailable:     "updates unavailable", UnavailableMessage: "%s can't update in this install location",
			DevelopmentBuild: "updates are available in the installed app",
			Error:            "update failed", CheckError: "couldn't check for updates", InstallError: "couldn't install the update",
			Available: "%s update available", AvailableMessage: "%s %s is available · you're on %s",
			ReleaseNotes: "what's new", AutomaticDownloads: "download updates automatically",
			Skip: "skip this version", RemindLater: "remind me later", Install: "install update",
			Downloading: "downloading update…", Installing: "installing update…",
			Ready: "ready to restart", ReadyMessage: "%s %s is ready", Later: "later", Relaunch: "restart now",
		}},
	}))
	var engine *tokens.Engine
	music := player.NewMusicWithTokens(func(ctx context.Context, videoID, visitor string) (string, string, error) {
		if engine == nil {
			return "", "", errors.New("token engine unavailable")
		}
		return engine.Tokens(ctx, videoID, visitor)
	})
	trayControl := &TrayControl{}
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) {
		trayControl.quitting.Store(true)
	})
	mygo.App.OnSecondInstance(func([]string, string) {
		if trayControl.window != nil {
			if err := trayControl.Action("open"); err != nil {
				log.Printf("show existing window: %v", err)
			}
		}
	})
	playback := player.NewPlayback(music)
	mini := &MiniWindow{}
	trayControl.minimizeToTray.Store(true)
	discord := integrations.NewDiscord()
	mediaSession := integrations.NewMediaSession(playback)
	spotifyAccount := spotifyaccount.NewSpotifyAccount()
	spotifyaccount.WireSpotifySearch(spotifyAccount, music.Search)
	spotifyLogin := spotify.NewSpotifyLogin(spotifyAccount)
	youtubeAccount := player.NewYouTubeAccount(music)
	youtubeLogin := youtube.NewYouTubeLogin(youtubeAccount)
	mygo.Bind(music, playback, trayControl, mini, discord, mediaSession, spotifyAccount, spotifyLogin, youtubeAccount, youtubeLogin, &system.Clipboard{})
	if err := mygo.Protocol.Handle("audio", player.Audio{Music: music}); err != nil {
		log.Fatal(err)
	}
	mygo.App.WhenReady(func() {
		engine = tokens.New()
		page := mygo.PageOptions{}
		if !mygo.IsDev() {
			page.DevTools = mygo.DevToolsDisabled
			page.PreloadScript = `window.addEventListener("contextmenu", event => event.preventDefault(), true);`
		}
		startMinimized := mygo.App.WasOpenedAtLogin() && startupMinimized()
		window := mygo.NewWindow(mygo.WindowOptions{
			Title:           "WiseWave",
			Width:           1180,
			Height:          760,
			MinWidth:        900,
			MinHeight:       600,
			Maximized:       true,
			Hidden:          startMinimized,
			URL:             "/",
			BackgroundColor: "#111113",
			TitleBarStyle:   mygo.TitleBarHidden,
			TitleBarHeight:  80,
			Page:            page,
		})
		window.Page().OnContextMenu(func(e *mygo.ContextMenuEvent) {
			e.PreventDefault()
		})
		window.SetWindowButtonsTheme(mygo.ThemeDark)
		centerRestored := func() {
			bounds := window.Bounds()
			display := mygo.Screen.DisplayMatching(bounds)
			area := display.WorkArea
			if area.Width <= 0 || area.Height <= 0 {
				area = display.Bounds
			}
			if area.Width <= 0 || area.Height <= 0 {
				window.SetSize(1180, 760)
				window.Center()
				return
			}

			targetW := int(float64(area.Width) * 0.8)
			targetH := int(float64(area.Height) * 0.8)
			if targetW < 960 {
				targetW = area.Width - 80
			}
			if targetH < 620 {
				targetH = area.Height - 80
			}
			if targetW > area.Width-60 {
				targetW = area.Width - 60
			}
			if targetH > area.Height-60 {
				targetH = area.Height - 60
			}

			x := area.X + (area.Width-targetW)/2
			y := area.Y + (area.Height-targetH)/2
			window.SetBounds(mygo.Rectangle{
				X:      x,
				Y:      y,
				Width:  targetW,
				Height: targetH,
			})
		}
		window.OnUnmaximize(func() {
			centerRestored()
		})
		trayControl.window = window
		window.OnLeaveFullScreen(func() {
			if trayControl.playerFullscreen {
				if err := PlayerFullscreenChanged.Emit(window, false); err != nil {
					log.Printf("leave player full screen: %v", err)
				}
			}
		})
		show := func() {
			if err := trayControl.Action("open"); err != nil {
				log.Printf("show window: %v", err)
			}
		}
		tray, err := mygo.NewTray(mygo.TrayOptions{
			ID: "wisewave", Icon: icon, ToolTip: "WiseWave",
		})
		if err != nil {
			log.Printf("system tray unavailable: %v", err)
		} else {
			trayControl.tray = tray
			tray.OnClick(show)
			tray.OnRightClick(func() {
				if err := showTrayMenu(trayControl); err != nil {
					log.Printf("tray menu: %v", err)
				}
			})
		}
		window.OnMinimize(func() {
			if trayControl.miniWhenMinimized.Load() && !mini.isOpen() {
				trayControl.autoMini.Store(true)
				mini.Open()
			}
		})
		window.OnRestore(func() {
			if trayControl.autoMini.Swap(false) {
				mini.Close()
			}
		})
		window.OnClose(func(event *mygo.CloseEvent) {
			if !trayControl.quitting.Load() && trayControl.tray != nil && trayControl.minimizeToTray.Load() {
				event.PreventDefault()
				window.Hide()
			} else if !trayControl.quitting.Load() {
				trayControl.quitting.Store(true)
				mygo.App.Quit()
			}
		})
		if startMinimized {
			window.Minimize()
		}
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
