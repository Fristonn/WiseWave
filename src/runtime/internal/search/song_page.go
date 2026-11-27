package search

import "wisewave-runtime/internal/models"

type SongPage struct {
	Tracks       []models.Track `json:"tracks"`
	Continuation string         `json:"continuation,omitempty"`
}
