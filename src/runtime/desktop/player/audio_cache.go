package player

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"wisewave-runtime/internal/innertube"
)

const audioCacheLimit int64 = 1 << 30
const audioCacheHeader = 56

type cachedAudio struct {
	data     []byte
	bitrate  int
	duration time.Duration
}

type CachedSong struct {
	ID      string `json:"id"`
	Size    int64  `json:"size"`
	Title   string `json:"title"`
	Artist  string `json:"artist"`
	Artwork string `json:"artwork"`
}

const cachedSongDetailsLimit = 16 << 10

type CacheClearProgress struct {
	Completed int    `json:"completed"`
	Total     int    `json:"total"`
	DeletedID string `json:"deleted_id"`
	Failed    int    `json:"failed"`
}

var CacheClearProgressChanged = mygo.NewEvent[CacheClearProgress]("cache-clear-progress-changed")

func (p *Playback) ClearCachedSongs() (CacheClearProgress, error) {
	if p.audioCache == nil {
		return CacheClearProgress{}, errors.New("audio cache unavailable")
	}
	c := p.audioCache
	c.mu.Lock()
	defer c.mu.Unlock()
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return CacheClearProgress{}, err
	}
	var names []string
	for _, entry := range entries {
		name := entry.Name()
		if id := strings.TrimSuffix(name, ".wwmeta"); id != name && videoID.MatchString(id) && !entry.IsDir() {
			names = append(names, name)
			continue
		}
		if (strings.HasPrefix(name, ".audio-") && strings.HasSuffix(name, ".part")) || strings.HasSuffix(name, ".wwchunk") {
			if !entry.IsDir() {
				names = append(names, name)
			}
			continue
		}
		id := strings.TrimSuffix(name, ".wwaudio")
		if name == id || !videoID.MatchString(id) || entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		names = append(names, name)
	}
	progress := CacheClearProgress{Total: len(names)}
	_ = CacheClearProgressChanged.Broadcast(progress)
	failedAudio := make(map[string]bool)
	for _, name := range names {
		progress.DeletedID = ""
		if !failedAudio[strings.TrimSuffix(name, ".wwmeta")] {
			id, audio := strings.CutSuffix(name, ".wwaudio")
			if err := os.Remove(filepath.Join(c.dir, name)); err != nil && !errors.Is(err, fs.ErrNotExist) {
				log.Printf("remove cached audio: %v", err)
				progress.Failed++
				if audio {
					failedAudio[id] = true
				}
			} else if audio {
				progress.DeletedID = id
			}
		}
		progress.Completed++
		_ = CacheClearProgressChanged.Broadcast(progress)
	}
	return progress, nil
}

func (p *Playback) ListCachedSongs() ([]CachedSong, error) {
	return p.listCachedSongs(true)
}

func (p *Playback) CachedSongCount() (int, error) {
	songs, err := p.listCachedSongs(false)
	return len(songs), err
}

func (p *Playback) listCachedSongs(includeDetails bool) ([]CachedSong, error) {
	if p.audioCache == nil {
		return nil, errors.New("audio cache unavailable")
	}
	c := p.audioCache
	c.mu.Lock()
	defer c.mu.Unlock()
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return nil, err
	}
	songs := make([]CachedSong, 0, len(entries))
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".wwaudio")
		if id == entry.Name() || !videoID.MatchString(id) || entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() || info.Size() <= audioCacheHeader {
			continue
		}
		var song CachedSong
		if includeDetails {
			song = c.readDetails(id)
		}
		song.ID, song.Size = id, info.Size()
		songs = append(songs, song)
	}
	sort.Slice(songs, func(i, j int) bool { return songs[i].ID < songs[j].ID })
	return songs, nil
}

type audioCache struct {
	mu    sync.Mutex
	dir   string
	limit int64
}

func newAudioCache() (*audioCache, error) {
	root, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(root, "WiseWave", "audio")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	return &audioCache{dir: dir, limit: audioCacheLimit}, nil
}

func (c *audioCache) get(id string) (*cachedAudio, error) {
	if !videoID.MatchString(id) {
		return nil, errors.New("invalid audio cache key")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	path := filepath.Join(c.dir, id+".wwaudio")
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() <= audioCacheHeader || info.Size() > c.limit {
		return nil, errors.New("invalid cached audio size")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(content) <= audioCacheHeader || string(content[:4]) != "WWA1" {
		return nil, errors.New("invalid cached audio header")
	}
	data := content[audioCacheHeader:]
	digest := sha256.Sum256(data)
	if string(content[24:56]) != string(digest[:]) {
		return nil, errors.New("cached audio checksum mismatch")
	}
	bitrate := binary.LittleEndian.Uint32(content[4:8])
	duration := binary.LittleEndian.Uint64(content[8:16])
	length := binary.LittleEndian.Uint64(content[16:24])
	if uint64(len(data)) != length || bitrate == 0 || duration == 0 || duration > uint64((24*time.Hour)/time.Millisecond) {
		return nil, errors.New("invalid cached audio metadata")
	}
	now := time.Now()
	if err := os.Chtimes(path, now, now); err != nil {
		log.Printf("update audio cache age for %s: %v", id, err)
	}
	return &cachedAudio{data: data, bitrate: int(bitrate), duration: time.Duration(duration) * time.Millisecond}, nil
}

func (c *audioCache) readDetails(id string) CachedSong {
	path := filepath.Join(c.dir, id+".wwmeta")
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > cachedSongDetailsLimit {
		return CachedSong{}
	}
	data, err := os.ReadFile(path)
	var song CachedSong
	if err != nil || json.Unmarshal(data, &song) != nil {
		return CachedSong{}
	}
	return song
}

func (c *audioCache) writeDetails(id string, song CachedSong) {
	if strings.TrimSpace(song.Title) == "" {
		return
	}
	existing := c.readDetails(id)
	details := existing
	details.ID = id
	if details.Title == "" {
		details.Title = song.Title
	}
	if details.Artist == "" {
		details.Artist = song.Artist
	}
	if details.Artwork == "" {
		details.Artwork = song.Artwork
	}
	if details == existing {
		return
	}
	data, err := json.Marshal(details)
	if err != nil || len(data) > cachedSongDetailsLimit {
		return
	}
	file, err := os.CreateTemp(c.dir, ".audio-*.part")
	if err != nil {
		return
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	_, err = file.Write(data)
	if err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp, filepath.Join(c.dir, id+".wwmeta"))
	}
	if err != nil {
		log.Printf("write cached song details for %s: %v", id, err)
	}
}

func (c *audioCache) rememberDetails(id string, song CachedSong) {
	if !videoID.MatchString(id) || strings.TrimSpace(song.Title) == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if info, err := os.Lstat(filepath.Join(c.dir, id+".wwaudio")); err == nil && info.Mode().IsRegular() {
		c.writeDetails(id, song)
	}
}

func (p *Playback) ResolveCachedSong(id string) (*CachedSong, error) {
	if !videoID.MatchString(id) || p.audioCache == nil {
		return nil, nil
	}
	c := p.audioCache
	c.mu.Lock()
	info, cacheErr := os.Lstat(filepath.Join(c.dir, id+".wwaudio"))
	existing := c.readDetails(id)
	c.mu.Unlock()
	if cacheErr != nil || !info.Mode().IsRegular() {
		return nil, nil
	}
	if existing.Title != "" {
		existing.ID, existing.Size = id, info.Size()
		return &existing, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	result, err := p.music.client.MusicClient.GetUpNext(ctx, innertube.UpNextOptions{VideoID: id})
	if err != nil {
		return nil, err
	}
	for _, item := range result.Items {
		if item.VideoID == id && item.Title != "" {
			artist := item.Artists
			if artist == "" {
				artist = item.Artist
			}
			song := CachedSong{ID: id, Title: item.Title, Artist: artist, Artwork: item.Thumbnail}
			p.audioCache.rememberDetails(id, song)
			return &song, nil
		}
	}
	return nil, nil
}

func (c *audioCache) remove(id string) error {
	if !videoID.MatchString(id) {
		return errors.New("invalid audio cache key")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	err := os.Remove(filepath.Join(c.dir, id+".wwaudio"))
	if err == nil || errors.Is(err, fs.ErrNotExist) {
		_ = os.Remove(filepath.Join(c.dir, id+".wwmeta"))
		return nil
	}
	return err
}

func (c *audioCache) put(id string, data []byte, bitrate int, duration time.Duration, song CachedSong) error {
	if !videoID.MatchString(id) {
		return errors.New("invalid audio cache key")
	}
	if len(data) == 0 || int64(len(data))+audioCacheHeader > c.limit || bitrate <= 0 || duration <= 0 {
		return errors.New("invalid audio cache entry")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	path := filepath.Join(c.dir, id+".wwaudio")
	if _, err := os.Stat(path); err == nil {
		c.writeDetails(id, song)
		return nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return err
	}
	type cacheFile struct {
		path     string
		size     int64
		modified time.Time
	}
	files := make([]cacheFile, 0, len(entries))
	var total int64
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !(strings.HasSuffix(name, ".wwchunk") || (strings.HasSuffix(name, ".wwaudio") && videoID.MatchString(strings.TrimSuffix(name, ".wwaudio")))) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			continue
		}
		total += info.Size()
		files = append(files, cacheFile{path: filepath.Join(c.dir, name), size: info.Size(), modified: info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].modified.Before(files[j].modified) })
	for _, file := range files {
		if total+int64(len(data))+audioCacheHeader <= c.limit {
			break
		}
		if err := os.Remove(file.path); err != nil {
			return err
		}
		if filepath.Ext(file.path) == ".wwaudio" {
			_ = os.Remove(strings.TrimSuffix(file.path, ".wwaudio") + ".wwmeta")
		}
		total -= file.size
	}
	file, err := os.CreateTemp(c.dir, ".audio-*.tmp")
	if err != nil {
		return err
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	header := make([]byte, audioCacheHeader)
	copy(header, "WWA1")
	binary.LittleEndian.PutUint32(header[4:8], uint32(bitrate))
	binary.LittleEndian.PutUint64(header[8:16], uint64(duration.Milliseconds()))
	binary.LittleEndian.PutUint64(header[16:24], uint64(len(data)))
	digest := sha256.Sum256(data)
	copy(header[24:56], digest[:])
	if _, err = file.Write(header); err == nil {
		_, err = file.Write(data)
	}
	if err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	c.writeDetails(id, song)
	return nil
}
