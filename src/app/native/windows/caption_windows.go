package windows

import (
	"log"
	"math"
	"syscall"
	"unsafe"

	"github.com/egoist/mygo"
	"golang.org/x/sys/windows"
)

const (
	wmSize            = 0x0005
	wmCancelMode      = 0x001F
	wmNCDestroy       = 0x0082
	wmNCHitTest       = 0x0084
	wmNCMouseMove     = 0x00A0
	wmNCLButtonDown   = 0x00A1
	wmNCLButtonUp     = 0x00A2
	wmNCLButtonDblClk = 0x00A3
	wmNCRButtonDown   = 0x00A4
	wmNCRButtonUp     = 0x00A5
	wmNCRButtonDblClk = 0x00A6
	wmSysCommand      = 0x0112
	wmNCMouseLeave    = 0x02A2
	wmDPIChanged      = 0x02E0
	htMaxButton       = 9
	scMaximize        = 0xF030
	scRestore         = 0xF120
	wsChild           = 0x40000000
	wsClipSiblings    = 0x04000000
	wsExLayered       = 0x00080000
	wsExNoRedirection = 0x00200000
	lwaAlpha          = 2
	swpNoActivate     = 0x0010
	swpShowWindow     = 0x0040
	swHide            = 0
	tmeLeaveNonClient = 0x00000012
	captionSubclassID = 1
	smCyFrame         = 33
	smCxPaddedBorder  = 92
)

var (
	captionUser32          = windows.NewLazySystemDLL("user32.dll")
	captionComctl          = windows.NewLazySystemDLL("comctl32.dll")
	createCaptionWindow    = captionUser32.NewProc("CreateWindowExW")
	destroyCaptionWindow   = captionUser32.NewProc("DestroyWindow")
	setCaptionLayer        = captionUser32.NewProc("SetLayeredWindowAttributes")
	setCaptionPosition     = captionUser32.NewProc("SetWindowPos")
	showCaptionWindow      = captionUser32.NewProc("ShowWindow")
	captionClientRect      = captionUser32.NewProc("GetClientRect")
	captionScreenRect      = captionUser32.NewProc("GetWindowRect")
	captionDPI             = captionUser32.NewProc("GetDpiForWindow")
	captionMetrics         = captionUser32.NewProc("GetSystemMetricsForDpi")
	captionIsZoomed        = captionUser32.NewProc("IsZoomed")
	captionIsIconic        = captionUser32.NewProc("IsIconic")
	trackCaptionMouse      = captionUser32.NewProc("TrackMouseEvent")
	defaultCaptionProc     = captionUser32.NewProc("DefWindowProcW")
	postCaptionMessage     = captionUser32.NewProc("PostMessageW")
	setCaptionSubclass     = captionComctl.NewProc("SetWindowSubclass")
	removeCaptionSubclass  = captionComctl.NewProc("RemoveWindowSubclass")
	defaultCaptionSubclass = captionComctl.NewProc("DefSubclassProc")
	captionSubclass        uintptr
	captionWindows         = make(map[uintptr]*maximizeOverlay)
)

type captionRect struct {
	left, top, right, bottom int32
}

type captionMouseTrack struct {
	size, flags uint32
	window      uintptr
	hoverTime   uint32
}

type maximizeOverlay struct {
	window                          *mygo.Window
	parent, hwnd                    uintptr
	bounds                          captionBounds
	placed                          captionRect
	resizeDPI                       uintptr
	resizeTop                       int32
	tooltip                         *captionTooltip
	pointer                         string
	maximized, fullscreen, tracking bool
}

type captionBounds struct {
	right, top, width, height float64
}

func (bounds captionBounds) pixels(client captionRect, dpi uintptr) captionRect {
	scale := float64(dpi) / 96
	px := func(value float64) int32 { return int32(math.Round(value * scale)) }
	return captionRect{
		left:   max(client.left, client.right-px(bounds.right+bounds.width)),
		top:    max(client.top, px(bounds.top)),
		right:  min(client.right, client.right-px(bounds.right)),
		bottom: min(client.bottom, px(bounds.top+bounds.height)),
	}
}

func (rect captionRect) containsScreenPoint(point uintptr) bool {
	x, y := int32(int16(point)), int32(int16(point>>16))
	return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
}

func captionWindowMessage(hwnd, message, wParam, lParam, _, _ uintptr) uintptr {
	overlay := captionWindows[hwnd]
	if overlay != nil {
		if message == wmNCDestroy {
			removeCaptionSubclass.Call(hwnd, captionSubclass, captionSubclassID)
			delete(captionWindows, hwnd)
			if hwnd == overlay.hwnd {
				overlay.hwnd = 0
			} else if hwnd == overlay.parent && overlay.tooltip != nil {
				overlay.tooltip.destroy()
			}
		} else {
			return overlay.message(hwnd, message, wParam, lParam)
		}
	}
	result, _, _ := defaultCaptionSubclass.Call(hwnd, message, wParam, lParam)
	return result
}

func (controls *CaptionControls) attach(window *mygo.Window) {
	if captionSubclass == 0 {
		captionSubclass = syscall.NewCallback(captionWindowMessage)
	}
	parent := window.NativeHandle()
	class, _ := windows.UTF16PtrFromString("STATIC")
	child, _, err := createCaptionWindow.Call(wsExLayered|wsExNoRedirection, uintptr(unsafe.Pointer(class)), 0,
		wsChild|wsClipSiblings, 0, 0, 0, 0, parent, 0, 0, 0)
	if child == 0 {
		log.Printf("create maximize hit region: %v", err)
		return
	}
	overlay := &maximizeOverlay{window: window, parent: parent, hwnd: child, pointer: "idle", maximized: window.IsMaximized()}
	layered, _, _ := setCaptionLayer.Call(child, 0, 255, lwaAlpha)
	childHook, _, _ := setCaptionSubclass.Call(child, captionSubclass, captionSubclassID, 0)
	parentHook, _, _ := setCaptionSubclass.Call(parent, captionSubclass, captionSubclassID, 0)
	if layered == 0 || childHook == 0 || parentHook == 0 {
		removeCaptionSubclass.Call(parent, captionSubclass, captionSubclassID)
		removeCaptionSubclass.Call(child, captionSubclass, captionSubclassID)
		destroyCaptionWindow.Call(child)
		log.Print("initialize maximize hit region failed")
		return
	}
	captionWindows[parent], captionWindows[child] = overlay, overlay
	controls.update = overlay.update
	overlay.tooltip = newCaptionTooltip(parent)
	if overlay.tooltip != nil {
		controls.tooltip = overlay.tooltip.setHover
		window.OnBlur(func() { overlay.tooltip.hover("") })
	}
	window.Page().OnDidNavigate(func(string) {
		overlay.update(0, 0, 0, 0)
	})
	window.OnEnterFullScreen(func() {
		overlay.fullscreen = true
		overlay.layout()
	})
	window.OnLeaveFullScreen(func() {
		overlay.fullscreen = false
		overlay.layout()
	})
}

func (o *maximizeOverlay) update(right, top, width, height float64) {
	for _, value := range [...]float64{right, top, width, height} {
		if math.IsNaN(value) || value < 0 || value > 4096 {
			return
		}
	}
	o.bounds = captionBounds{right: right, top: top, width: width, height: height}
	o.layout()
}

func (o *maximizeOverlay) layout() {
	if o.hwnd == 0 {
		return
	}
	iconic, _, _ := captionIsIconic.Call(o.parent)
	if o.bounds.width == 0 || o.bounds.height == 0 || o.fullscreen || iconic != 0 {
		o.hide()
		return
	}
	var client captionRect
	valid, _, _ := captionClientRect.Call(o.parent, uintptr(unsafe.Pointer(&client)))
	dpi, _, _ := captionDPI.Call(o.parent)
	next := o.bounds.pixels(client, dpi)
	if !o.maximized && dpi != 0 {
		if o.resizeDPI != dpi {
			frame, _, _ := captionMetrics.Call(smCyFrame, dpi)
			padding, _, _ := captionMetrics.Call(smCxPaddedBorder, dpi)
			o.resizeTop = int32(frame + padding)
			o.resizeDPI = dpi
		}
		next.top = max(next.top, o.resizeTop)
	}
	width, height := next.right-next.left, next.bottom-next.top
	if valid == 0 || dpi == 0 || width <= 0 || height <= 0 {
		o.hide()
	} else if next != o.placed {
		if placed, _, _ := setCaptionPosition.Call(o.hwnd, 0, uintptr(next.left), uintptr(next.top), uintptr(width), uintptr(height), swpNoActivate|swpShowWindow); placed != 0 {
			o.placed = next
		} else {
			o.hide()
		}
	}
}

func (o *maximizeOverlay) hide() {
	if o.placed != (captionRect{}) {
		showCaptionWindow.Call(o.hwnd, swHide)
		o.placed = captionRect{}
	}
	o.tracking = false
	o.setPointer("idle")
	if o.tooltip != nil {
		o.tooltip.hover("")
	}
}

func (o *maximizeOverlay) contains(point uintptr) bool {
	var bounds captionRect
	ok, _, _ := captionScreenRect.Call(o.hwnd, uintptr(unsafe.Pointer(&bounds)))
	return ok != 0 && o.placed != (captionRect{}) && bounds.containsScreenPoint(point)
}

func (o *maximizeOverlay) setPointer(state string) {
	if state != o.pointer {
		o.pointer = state
		_ = CaptionPointerChanged.Emit(o.window, state)
	}
}

func (o *maximizeOverlay) message(hwnd, message, wParam, lParam uintptr) uintptr {
	if hwnd == o.parent {
		result, _, _ := defaultCaptionSubclass.Call(hwnd, message, wParam, lParam)
		switch message {
		case wmSize, wmDPIChanged:
			zoomed, _, _ := captionIsZoomed.Call(hwnd)
			maximized := zoomed != 0
			if maximized != o.maximized {
				o.maximized = maximized
				_ = CaptionMaximizedChanged.Emit(o.window, maximized)
			}
			o.layout()
		}
		return result
	}
	switch message {
	case wmNCHitTest:
		if o.contains(lParam) {
			return htMaxButton
		}
	case wmNCMouseMove:
		if !o.tracking {
			track := captionMouseTrack{flags: tmeLeaveNonClient, window: hwnd}
			track.size = uint32(unsafe.Sizeof(track))
			tracked, _, _ := trackCaptionMouse.Call(uintptr(unsafe.Pointer(&track)))
			o.tracking = tracked != 0
		}
		if o.pointer == "idle" {
			o.setPointer("hover")
			if o.tooltip != nil {
				o.tooltip.hover("maximize")
			}
		}
		result, _, _ := defaultCaptionProc.Call(hwnd, message, wParam, lParam)
		return result
	case wmNCMouseLeave, wmCancelMode:
		o.tracking = false
		o.setPointer("idle")
		if o.tooltip != nil {
			o.tooltip.setHover("maximize", false)
		}
		return 0
	case wmNCLButtonDown, wmNCLButtonDblClk:
		o.setPointer("pressed")
		if o.tooltip != nil {
			o.tooltip.setHover("maximize", false)
		}
		return 0
	case wmNCLButtonUp:
		inside := o.contains(lParam)
		if o.pointer == "pressed" && inside {
			command := uintptr(scMaximize)
			if zoomed, _, _ := captionIsZoomed.Call(o.parent); zoomed != 0 {
				command = scRestore
			}
			postCaptionMessage.Call(o.parent, wmSysCommand, command, 0)
		}
		if inside {
			o.setPointer("hover")
		} else {
			o.setPointer("idle")
		}
		return 0
	case wmNCRButtonDown, wmNCRButtonUp, wmNCRButtonDblClk:
		return 0
	}
	result, _, _ := defaultCaptionSubclass.Call(hwnd, message, wParam, lParam)
	return result
}
