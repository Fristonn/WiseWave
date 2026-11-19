package windows

import "github.com/egoist/mygo"

type CaptionControls struct {
	update  func(float64, float64, float64, float64)
	tooltip func(string, bool)
}

func (controls *CaptionControls) SetTooltip(button string, visible bool) {
	mygo.RunOnMain(func() {
		if controls.tooltip != nil {
			controls.tooltip(button, visible)
		}
	})
}

func (controls *CaptionControls) SetMaximizeBounds(right, top, width, height float64) {
	mygo.RunOnMain(func() {
		if controls.update != nil {
			controls.update(right, top, width, height)
		}
	})
}

var CaptionPointerChanged = mygo.NewEvent[string]("caption-pointer-changed")
var CaptionMaximizedChanged = mygo.NewEvent[bool]("caption-maximized-changed")
