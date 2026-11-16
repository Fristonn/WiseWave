package player

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

var rangeCacheMu sync.Mutex

type savedAudioRange struct {
	ContentRange string `json:"range"`
	ContentType  string `json:"type"`
	Data         []byte `json:"data"`
}

func audioRangeCachePath(raw string, start int64) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	query := parsed.Query()
	if query.Get("id") == "" || query.Get("itag") == "" || query.Get("lmt") == "" || query.Get("clen") == "" {
		return ""
	}
	identity := query.Get("id") + ":" + query.Get("itag") + ":" + query.Get("lmt") + ":" + query.Get("clen")
	key, _ := json.Marshal(struct {
		Identity string
		Start    int64
	}{identity, start})
	digest := sha256.Sum256(key)
	root, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(root, "WiseWave", "audio", hex.EncodeToString(digest[:])+".wwchunk")
}

func readAudioRange(path string) *http.Response {
	if path == "" {
		return nil
	}
	rangeCacheMu.Lock()
	defer rangeCacheMu.Unlock()
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 2*audioRangeSize {
		return nil
	}
	data, err := os.ReadFile(path)
	var saved savedAudioRange
	if err != nil || json.Unmarshal(data, &saved) != nil || len(saved.Data) == 0 {
		return nil
	}
	_, end, total, ok := parseAudioContentRange(saved.ContentRange, "")
	start, _, _, _ := parseAudioContentRange(saved.ContentRange, "")
	if !ok || int64(len(saved.Data)) != end-start+1 || total <= end {
		return nil
	}
	now := time.Now()
	_ = os.Chtimes(path, now, now)
	header := make(http.Header)
	header.Set("Content-Range", saved.ContentRange)
	header.Set("Content-Type", saved.ContentType)
	return &http.Response{StatusCode: http.StatusPartialContent, Header: header, ContentLength: int64(len(saved.Data)), Body: io.NopCloser(bytes.NewReader(saved.Data))}
}

type cachingAudioRange struct {
	io.ReadCloser
	path     string
	saved    savedAudioRange
	expected int64
	disabled bool
}

func (r *cachingAudioRange) Read(buffer []byte) (int, error) {
	n, err := r.ReadCloser.Read(buffer)
	if !r.disabled {
		r.saved.Data = append(r.saved.Data, buffer[:n]...)
		if int64(len(r.saved.Data)) > r.expected {
			r.disabled = true
			r.saved.Data = nil
		}
		if !r.disabled && int64(len(r.saved.Data)) == r.expected {
			r.disabled = true
			saveAudioRange(r.path, r.saved)
			r.saved.Data = nil
		}
	}
	return n, err
}

func saveAudioRange(path string, saved savedAudioRange) {
	rangeCacheMu.Lock()
	defer rangeCacheMu.Unlock()
	dir := filepath.Dir(path)
	if os.MkdirAll(dir, 0700) != nil {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var files []os.FileInfo
	var total int64
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.Mode().IsRegular() {
			total += info.Size()
			files = append(files, info)
		}
	}
	data, err := json.Marshal(saved)
	if err != nil {
		return
	}
	sort.Slice(files, func(i, j int) bool { return files[i].ModTime().Before(files[j].ModTime()) })
	for _, file := range files {
		if total+int64(len(data)) <= audioCacheLimit {
			break
		}
		if filepath.Ext(file.Name()) != ".wwchunk" {
			continue
		}
		if os.Remove(filepath.Join(dir, file.Name())) == nil {
			total -= file.Size()
		}
	}
	if total+int64(len(data)) > audioCacheLimit {
		return
	}
	file, err := os.CreateTemp(dir, ".range-*.tmp")
	if err != nil {
		return
	}
	temp := file.Name()
	defer os.Remove(temp)
	_, err = file.Write(data)
	closeErr := file.Close()
	if err == nil && closeErr == nil {
		_ = os.Rename(temp, path)
	}
}
