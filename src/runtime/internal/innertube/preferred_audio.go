package innertube

import (
	"context"
	"strings"
	"wisewave-runtime/internal/search"
)

func (client *Client) PreferredAudioID(ctx context.Context, id string) string {
	raw, err := client.MusicClient.executePlayback(ctx, "next", map[string]any{"videoId": id})
	if err != nil {
		return id
	}
	var selected MusicItem
	var find func(any)
	find = func(value any) {
		if selected.VideoID != "" {
			return
		}
		switch node := value.(type) {
		case []any:
			for _, child := range node {
				find(child)
			}
		case *jsonObject:
			if renderer, ok := node.get("playlistPanelVideoRenderer").(*jsonObject); ok && nestedString(renderer.get("navigationEndpoint"), "musicVideoType") == "MUSIC_VIDEO_TYPE_OMV" {
				item := parseMusicItem(KindVideo, renderer)
				if item.VideoID == id {
					selected = item
					return
				}
			}
			for _, member := range node.members {
				find(member.value)
			}
		}
	}
	find(decodeResponse(raw))
	title := preferredAudioTitle(selected.Title)
	artist := search.Normalize(selected.Artists)
	if artist == "" {
		artist = search.Normalize(selected.Artist)
	}
	if title == "" || artist == "" {
		return id
	}
	query := selected.Title + " " + selected.Artists
	if selected.Artists == "" {
		query = selected.Title + " " + selected.Artist
	}
	raw, err = client.MusicClient.executeAnonymous(ctx, "search", map[string]any{"query": query, "params": "EgWKAQIIAWoKEAkQBRAKEAMQBA=="})
	if err != nil {
		return id
	}
	duration := parseDurationSeconds(selected.Duration)
	match := ""
	var findSong func(any)
	findSong = func(value any) {
		if match != "" {
			return
		}
		switch node := value.(type) {
		case []any:
			for _, child := range node {
				findSong(child)
			}
		case *jsonObject:
			if renderer, ok := node.get("musicResponsiveListItemRenderer").(*jsonObject); ok && nestedString(renderer, "musicVideoType") == "MUSIC_VIDEO_TYPE_ATV" {
				item := parseMusicItem(KindTrack, renderer)
				candidateArtist := item.Artists
				if candidateArtist == "" {
					candidateArtist = item.Artist
				}
				candidateDuration := parseDurationSeconds(item.Duration)
				if item.VideoID != "" && item.VideoID != id && preferredAudioTitle(item.Title) == title && search.Normalize(candidateArtist) == artist && duration > 0 && candidateDuration > 0 && duration-candidateDuration <= 30 && candidateDuration-duration <= 30 {
					match = item.VideoID
					return
				}
			}
			for _, member := range node.members {
				findSong(member.value)
			}
		}
	}
	findSong(decodeResponse(raw))
	if match != "" {
		return match
	}
	return id
}

func preferredAudioTitle(title string) string {
	value := strings.TrimSpace(title)
	lower := strings.ToLower(value)
	for _, suffix := range []string{" (official music video)", " (official video)", " [official music video]", " [official video]"} {
		if strings.HasSuffix(lower, suffix) {
			value = strings.TrimSpace(value[:len(value)-len(suffix)])
			break
		}
	}
	return search.Normalize(value)
}
