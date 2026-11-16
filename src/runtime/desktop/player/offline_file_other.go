//go:build !windows

package player

import "os"

func openDownloadedAudio(path string) (*os.File, error) {
	return os.Open(path)
}
