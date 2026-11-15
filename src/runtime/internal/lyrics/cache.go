package lyrics

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const recordCacheLimit int64 = 32 << 20
const recordCacheEntryLimit int64 = 2 << 20
const recordCacheCountLimit = 1024

type recordCache struct {
	dir string
	mu  sync.Mutex
}

func newRecordCache() *recordCache {
	root, err := os.UserCacheDir()
	if err != nil || strings.TrimSpace(root) == "" {
		return nil
	}
	return &recordCache{dir: filepath.Join(root, "WiseWave", "lyrics")}
}

func (c *recordCache) path(key string) string {
	digest := sha256.Sum256([]byte(key))
	return filepath.Join(c.dir, hex.EncodeToString(digest[:])+".json")
}

func validCachedRecord(record *Record) bool {
	if record == nil || record.Refining || strings.TrimSpace(record.TrackName) == "" || strings.TrimSpace(record.ArtistName) == "" || strings.TrimSpace(record.Source) == "" {
		return false
	}
	return record.Instrumental || strings.TrimSpace(record.PlainLyrics) != "" || strings.TrimSpace(record.SyncedLyrics) != "" || len(record.Lines) > 0
}

func cachedRecordQuality(record *Record) int {
	if !validCachedRecord(record) {
		return 0
	}
	return documentQuality(&LyricsDocument{Lines: record.Lines, SyncedLyrics: record.SyncedLyrics, PlainLyrics: record.PlainLyrics, Instrumental: record.Instrumental})
}

func (c *recordCache) read(path string) *Record {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > recordCacheEntryLimit {
		return nil
	}
	content, err := os.ReadFile(path)
	if err != nil || int64(len(content)) > recordCacheEntryLimit {
		return nil
	}
	var record Record
	if json.Unmarshal(content, &record) != nil || !validCachedRecord(&record) {
		return nil
	}
	return &record
}

func (c *recordCache) get(key string) *Record {
	if c == nil || key == "" {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	path := c.path(key)
	record := c.read(path)
	if record != nil {
		now := time.Now()
		_ = os.Chtimes(path, now, now)
	}
	return record
}

func (c *recordCache) put(key string, record *Record) {
	if c == nil || key == "" || !validCachedRecord(record) {
		return
	}
	content, err := json.Marshal(record)
	if err != nil || int64(len(content)) > recordCacheEntryLimit {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if os.MkdirAll(c.dir, 0700) != nil {
		return
	}
	path := c.path(key)
	if existing := c.read(path); existing != nil && cachedRecordQuality(existing) > cachedRecordQuality(record) {
		return
	}
	file, err := os.CreateTemp(c.dir, ".lyrics-*.tmp")
	if err != nil {
		return
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	if _, err := file.Write(content); err != nil {
		_ = file.Close()
		return
	}
	if file.Close() != nil || os.Rename(tmp, path) != nil {
		return
	}
	c.prune()
}

func (c *recordCache) prune() {
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return
	}
	type cacheEntry struct {
		path     string
		size     int64
		modified time.Time
	}
	var files []cacheEntry
	var total int64
	for _, entry := range entries {
		name := entry.Name()
		if len(name) != 69 || !strings.HasSuffix(name, ".json") {
			continue
		}
		if _, err := hex.DecodeString(strings.TrimSuffix(name, ".json")); err != nil {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		total += info.Size()
		files = append(files, cacheEntry{path: filepath.Join(c.dir, name), size: info.Size(), modified: info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].modified.Before(files[j].modified) })
	for len(files) > 0 && (len(files) > recordCacheCountLimit || total > recordCacheLimit) {
		oldest := files[0]
		files = files[1:]
		if err := os.Remove(oldest.path); err == nil || os.IsNotExist(err) {
			total -= oldest.size
		}
	}
}
