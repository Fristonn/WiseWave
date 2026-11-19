package windows

import (
	"time"
	"unsafe"

	"github.com/egoist/mygo"
	"golang.org/x/sys/windows"
)

const (
	wsPopup             = 0x80000000
	wsExTopmost         = 0x00000008
	wsExTransparent     = 0x00000020
	wsExNoActivate      = 0x08000000
	ttsNoPrefix         = 0x0002
	ttfTrackAbsolute    = 0x00A0
	ttfTransparent      = 0x0100
	ttmGetDelayTime     = 0x0400 + 21
	ttmTrackActivate    = 0x0400 + 17
	ttmTrackPosition    = 0x0400 + 18
	ttmAddToolW         = 0x0400 + 50
	ttmUpdateTipTextW   = 0x0400 + 57
	ttdtAutoPop         = 2
	iccBarClasses       = 4
	gaRoot              = 2
	captionTooltipDelay = 1100 * time.Millisecond
)

var (
	initCaptionControls = captionComctl.NewProc("InitCommonControlsEx")
	sendCaptionMessage  = captionUser32.NewProc("SendMessageW")
	captionCursor       = captionUser32.NewProc("GetCursorPos")
	captionWindowAt     = captionUser32.NewProc("WindowFromPoint")
	captionRootWindow   = captionUser32.NewProc("GetAncestor")
)

type captionToolInfo struct {
	size, flags     uint32
	owner, id       uintptr
	rect            captionRect
	instance        uintptr
	text            *uint16
	param, reserved uintptr
}

type captionPoint struct {
	x, y int32
}

func (p captionPoint) packed() uintptr {
	return uintptr(uint16(p.x)) | uintptr(uint16(p.y))<<16
}

type captionTooltip struct {
	hwnd       uintptr
	tool       captionToolInfo
	hovered    string
	visible    bool
	timer      *time.Timer
	generation uint64
}

func newCaptionTooltip(owner uintptr) *captionTooltip {
	classes := struct{ size, flags uint32 }{8, iccBarClasses}
	initCaptionControls.Call(uintptr(unsafe.Pointer(&classes)))
	class, _ := windows.UTF16PtrFromString("tooltips_class32")
	hwnd, _, _ := createCaptionWindow.Call(wsExTopmost|wsExTransparent|wsExNoActivate, uintptr(unsafe.Pointer(class)), 0,
		wsPopup|ttsNoPrefix, 0, 0, 0, 0, owner, 0, 0, 0)
	if hwnd == 0 {
		return nil
	}
	tip := &captionTooltip{hwnd: hwnd}
	tip.tool = captionToolInfo{size: uint32(unsafe.Sizeof(tip.tool)), flags: ttfTrackAbsolute | ttfTransparent, owner: owner, id: 1}
	tip.tool.text, _ = windows.UTF16PtrFromString("")
	if added := tip.sendTool(ttmAddToolW, 0); added == 0 {
		destroyCaptionWindow.Call(hwnd)
		return nil
	}
	return tip
}

func (tip *captionTooltip) sendTool(message, value uintptr) uintptr {
	result, _, _ := sendCaptionMessage.Call(tip.hwnd, message, value, uintptr(unsafe.Pointer(&tip.tool)))
	return result
}

func (tip *captionTooltip) delay(kind uintptr) time.Duration {
	ms, _, _ := sendCaptionMessage.Call(tip.hwnd, ttmGetDelayTime, kind, 0)
	return time.Duration(ms) * time.Millisecond
}

func (tip *captionTooltip) schedule(delay time.Duration, run func()) {
	generation := tip.generation
	tip.timer = time.AfterFunc(delay, func() {
		mygo.RunOnMain(func() {
			if tip.hwnd != 0 && tip.generation == generation {
				run()
			}
		})
	})
}

func (tip *captionTooltip) setHover(button string, visible bool) {
	if visible {
		tip.hover(button)
	} else if button == "" || button == tip.hovered {
		tip.hover("")
	}
}

func (tip *captionTooltip) hover(button string) {
	if tip.hwnd == 0 || button == tip.hovered {
		return
	}
	tip.generation++
	if tip.timer != nil {
		tip.timer.Stop()
	}
	if tip.visible {
		tip.sendTool(ttmTrackActivate, 0)
		tip.visible = false
	}
	tip.hovered = button
	switch button {
	case "minimize", "maximize", "close":
		tip.schedule(captionTooltipDelay, func() { tip.show(button) })
	}
}

func (tip *captionTooltip) show(button string) {
	var cursor captionPoint
	if ok, _, _ := captionCursor.Call(uintptr(unsafe.Pointer(&cursor))); ok == 0 {
		return
	}
	point := uintptr(uint32(cursor.x)) | uintptr(uint32(cursor.y))<<32
	hit, _, _ := captionWindowAt.Call(point)
	root, _, _ := captionRootWindow.Call(hit, gaRoot)
	if root != tip.tool.owner {
		return
	}
	var label string
	switch button {
	case "minimize":
		label = "Minimize"
	case "maximize":
		label = "Maximize"
		if zoomed, _, _ := captionIsZoomed.Call(tip.tool.owner); zoomed != 0 {
			label = "Restore Down"
		}
	case "close":
		label = "Close"
	}
	tip.tool.text, _ = windows.UTF16PtrFromString(label)
	tip.sendTool(ttmUpdateTipTextW, 0)
	dpi, _, _ := captionDPI.Call(tip.tool.owner)
	cursor.x += int32(8 * dpi / 96)
	cursor.y += int32(20 * dpi / 96)
	sendCaptionMessage.Call(tip.hwnd, ttmTrackPosition, 0, cursor.packed())
	tip.sendTool(ttmTrackActivate, 1)
	tip.visible = true
	tip.schedule(tip.delay(ttdtAutoPop), func() {
		tip.sendTool(ttmTrackActivate, 0)
		tip.visible = false
	})
}

func (tip *captionTooltip) destroy() {
	tip.hover("")
	destroyCaptionWindow.Call(tip.hwnd)
	tip.hwnd = 0
}
