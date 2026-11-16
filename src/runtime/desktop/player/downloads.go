package player

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/audio"
	"wisewave-runtime/internal/downloader"
	"wisewave-runtime/internal/models"
)

type DownloadProgress struct {
	TrackID  string `json:"track_id"`
	Received int64  `json:"received"`
	Total    int64  `json:"total"`
}

var DownloadProgressChanged = mygo.NewEvent[DownloadProgress]("download-progress-changed")

func (m *Music) downloadService() (*downloader.Service, error) {
	m.downloadsOnce.Do(func() {
		directory, err := mygo.App.Path(mygo.PathUserData)
		if err != nil || strings.TrimSpace(directory) == "" {
			directory, err = os.UserConfigDir()
			if err != nil {
				m.downloadsErr = err
				return
			}
			directory = filepath.Join(directory, "WiseWave")
		}
		directory = filepath.Join(directory, "downloads")
		if err := os.MkdirAll(filepath.Join(directory, "offline"), 0755); err != nil {
			m.downloadsErr = err
			return
		}
		m.downloads = downloader.NewService(nil, directory, m.client, m.saavn, m.gaana, m.lyrics, m.streams)
		m.downloads.SetPerSongFolders(true)
		m.downloads.SetProgressCallback(func(id string, received, total int64) {
			_ = DownloadProgressChanged.Broadcast(DownloadProgress{TrackID: id, Received: received, Total: total})
		})
		m.downloads.SetStreamResolver(func(id, title, artist string) (string, error) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			stream, err := m.resolveAudio(ctx, id, 0)
			if err != nil {
				return "", errors.New("Audio is unavailable for download")
			}
			if stream.IsHLS || strings.Contains(strings.ToLower(stream.MimeType), "mpegurl") {
				return "", errors.New("This stream cannot be saved for offline playback")
			}
			return stream.URL, nil
		})
		m.downloads.SetStreamOpener(func(url string) (*http.Response, error) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			response, err := openAudioStream(ctx, m.http, url, audioUserAgent)
			if err != nil {
				cancel()
				return nil, err
			}
			response.Body = &downloadBody{ReadCloser: response.Body, cancel: cancel}
			return response, nil
		})
	})
	return m.downloads, m.downloadsErr
}

type downloadBody struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (body *downloadBody) Close() error {
	body.cancel()
	return body.ReadCloser.Close()
}

func (p *Playback) downloadedAudio(cancel context.CancelFunc, id string) (audio.Decoder, *streamBuffer, time.Duration, error) {
	service, err := p.music.downloadService()
	if err != nil {
		return nil, nil, 0, nil
	}
	tracks, err := service.ListOfflineTracks()
	if err != nil {
		return nil, nil, 0, nil
	}
	var path string
	var duration time.Duration
	for _, track := range tracks {
		if track.ID == id {
			path = track.AudioFilePath
			duration = time.Duration(track.DurationSeconds) * time.Second
			break
		}
	}
	if path == "" {
		return nil, nil, 0, nil
	}
	file, err := openDownloadedAudio(path)
	if err != nil {
		log.Printf("open downloaded audio for %s: %v", id, err)
		return nil, nil, 0, nil
	}
	info, err := file.Stat()
	if err != nil || info.Size() <= 0 {
		file.Close()
		return nil, nil, 0, errors.New("Saved audio is incomplete")
	}
	switch strings.ToLower(filepath.Ext(path)) {
	case ".m4a", ".aac":
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, maxAACSourceBytes+1))
		if err != nil || len(data) > maxAACSourceBytes {
			return nil, nil, 0, errors.New("Saved audio exceeds the playback limit")
		}
		decoder, err := newM4AAACDecoder(data)
		return decoder, nil, duration, err
	case ".webm", ".opus", ".ogg":
		buffer := newStreamBuffer(file, cancel, info.Size(), 0, duration, nil)
		decoder, err := newOpus(buffer)
		if err != nil {
			buffer.Close()
		}
		return decoder, buffer, duration, err
	default:
		file.Close()
		return nil, nil, 0, errors.New("Saved audio format is unsupported")
	}
}

func (m *Music) Download(track models.Track) (*downloader.DownloadResult, error) {
	if !validTrackID(track.ID) {
		return nil, errors.New("Invalid track")
	}
	service, err := m.downloadService()
	if err != nil {
		return nil, err
	}
	result, err := service.DownloadWithMetadata(track)
	if err != nil {
		return nil, errors.New("Download failed. Check your connection and try again.")
	}
	return result, nil
}

func (m *Music) ListDownloads() ([]downloader.OfflineTrack, error) {
	service, err := m.downloadService()
	if err != nil {
		return nil, err
	}
	tracks, err := service.ListOfflineTracks()
	if err != nil {
		return nil, err
	}
	if tracks == nil {
		tracks = []downloader.OfflineTrack{}
	}
	sort.Slice(tracks, func(i, j int) bool {
		if tracks[i].ModifiedAt == tracks[j].ModifiedAt {
			return tracks[i].ID < tracks[j].ID
		}
		return tracks[i].ModifiedAt > tracks[j].ModifiedAt
	})
	return tracks, nil
}

func (m *Music) DeleteDownload(id string) error {
	if !validTrackID(id) {
		return errors.New("invalid track")
	}
	service, err := m.downloadService()
	if err != nil {
		return err
	}
	if err := service.DeleteOfflineTrack(id); err != nil {
		return errors.New("couldn't delete this download. try again")
	}
	return nil
}

func (m *Music) RevealDownload(id string) error {
	if !validTrackID(id) {
		return errors.New("invalid track")
	}
	tracks, err := m.ListDownloads()
	if err != nil {
		return err
	}
	for _, track := range tracks {
		if track.ID != id {
			continue
		}
		info, err := os.Lstat(track.AudioFilePath)
		if err != nil || !info.Mode().IsRegular() {
			return errors.New("downloaded file is unavailable")
		}
		mygo.Shell.ShowItemInFolder(track.AudioFilePath)
		return nil
	}
	return errors.New("downloaded file is unavailable")
}
