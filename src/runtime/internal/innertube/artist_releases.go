package innertube

import (
	"context"
	"strings"
	"time"
)

func catalogReleaseType(subtitle interface{}) string {
	for _, run := range array(object(subtitle)["runs"]) {
		switch strings.ToLower(strings.TrimSpace(stringValue(object(run)["text"]))) {
		case "album":
			return "Album"
		case "single":
			return "Single"
		case "ep":
			return "EP"
		}
	}
	return ""
}

func artistReleaseShelf(title string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(strings.ReplaceAll(title, " and ", " & "))) {
	case "albums":
		return "Album", true
	case "singles":
		return "Single", true
	case "eps":
		return "EP", true
	case "singles & eps", "singles & ep", "singles and ep":
		return "Single / EP", true
	case "releases", "albums & singles", "albums & eps", "albums, singles & eps":
		return "", true
	default:
		return "", false
	}
}

func releaseShelfEndpoint(shelf, header map[string]interface{}) map[string]interface{} {
	for _, part := range []interface{}{header["moreContentButton"], shelf["moreContentButton"], shelf["bottomEndpoint"], header["title"]} {
		var endpoint map[string]interface{}
		walkCatalog(part, func(node map[string]interface{}) {
			browse := object(node["browseEndpoint"])
			if endpoint == nil && catalogIDPattern.MatchString(stringValue(browse["browseId"])) {
				endpoint = browse
			}
		})
		if endpoint != nil {
			return endpoint
		}
	}
	return nil
}

func releaseContinuations(root interface{}) []string {
	var tokens []string
	walkCatalog(root, func(node map[string]interface{}) {
		if token := stringValue(object(node["nextContinuationData"])["continuation"]); token != "" {
			tokens = append(tokens, token)
		}
		if renderer := object(node["continuationItemRenderer"]); renderer != nil {
			walkCatalog(renderer, func(item map[string]interface{}) {
				if token := stringValue(object(item["continuationCommand"])["token"]); token != "" {
					tokens = append(tokens, token)
				}
			})
		}
	})
	return tokens
}

func (client *Client) artistReleases(root interface{}) ([]CatalogAlbum, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	albums := []CatalogAlbum{}
	seen := make(map[string]int)
	incomplete := false
	visitor := stringValue(object(object(root)["responseContext"])["visitorData"])
	walkCatalog(root, func(node map[string]interface{}) {
		shelf := object(node["musicCarouselShelfRenderer"])
		if shelf == nil {
			return
		}
		header := object(object(shelf["header"])["musicCarouselShelfBasicHeaderRenderer"])
		kind, ok := artistReleaseShelf(textValue(header["title"]))
		if !ok {
			return
		}
		appendPage := func(page interface{}) int {
			_, found, _, _ := catalogSearchItemsWithAlbumLimit(page, 0)
			for _, album := range found {
				if album.ReleaseType == "" {
					album.ReleaseType = kind
				}
				if index, exists := seen[album.ID]; exists {
					existing := &albums[index]
					if existing.Year == "" {
						existing.Year = album.Year
					}
					if existing.Artist == "" {
						existing.Artist = album.Artist
					}
					if existing.ArtworkURL == "" {
						existing.ArtworkURL = album.ArtworkURL
					}
					if album.ReleaseType != "" && (existing.ReleaseType == "" || existing.ReleaseType == "Single / EP") {
						existing.ReleaseType = album.ReleaseType
					}
					continue
				}
				seen[album.ID] = len(albums)
				albums = append(albums, album)
			}
			return len(found)
		}
		queue := releaseContinuations(shelf)
		shelfVisitor := visitor
		if endpoint := releaseShelfEndpoint(shelf, header); endpoint != nil {
			payload := map[string]interface{}{"browseId": stringValue(endpoint["browseId"])}
			if params := stringValue(endpoint["params"]); params != "" {
				payload["params"] = params
			}
			page, err := client.catalogRequestContext(ctx, "browse", payload, shelfVisitor)
			if err != nil {
				incomplete = true
			} else {
				if shelfVisitor == "" {
					shelfVisitor = stringValue(object(page["responseContext"])["visitorData"])
				}
				next := releaseContinuations(page)
				if appendPage(page) == 0 && len(next) == 0 && len(array(shelf["contents"])) > 0 {
					incomplete = true
				}
				queue = append(next, queue...)
			}
		}
		seenTokens := map[string]bool{}
		for len(queue) > 0 {
			next := queue[0]
			queue = queue[1:]
			if seenTokens[next] {
				continue
			}
			if len(seenTokens) >= 1000 || ctx.Err() != nil {
				incomplete = true
				break
			}
			seenTokens[next] = true
			page, err := client.catalogRequestContext(ctx, "browse", map[string]interface{}{"continuation": next}, shelfVisitor)
			if err != nil {
				incomplete = true
				continue
			}
			following := releaseContinuations(page)
			if appendPage(page) == 0 && len(following) == 0 {
				incomplete = true
			}
			queue = append(queue, following...)
		}
		appendPage(shelf["contents"])
	})
	return albums, incomplete
}
