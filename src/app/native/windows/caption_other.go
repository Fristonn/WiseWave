//go:build !windows

package windows

import "github.com/egoist/mygo"

func (controls *CaptionControls) attach(window *mygo.Window) {}
