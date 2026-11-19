package windows

import "testing"

func TestCaptionBoundsPixels(t *testing.T) {
	bounds := captionBounds{right: 68.2, top: 22, width: 50.6, height: 44}
	for _, test := range []struct {
		dpi    uintptr
		client captionRect
		want   captionRect
	}{
		{96, captionRect{0, 0, 1366, 768}, captionRect{1247, 22, 1298, 66}},
		{120, captionRect{0, 0, 1500, 900}, captionRect{1351, 28, 1415, 83}},
		{144, captionRect{0, 0, 1500, 900}, captionRect{1322, 33, 1398, 99}},
		{192, captionRect{0, 0, 1920, 1080}, captionRect{1682, 44, 1784, 132}},
		{96, captionRect{0, 0, 100, 40}, captionRect{0, 22, 32, 40}},
	} {
		if got := bounds.pixels(test.client, test.dpi); got != test.want {
			t.Errorf("dpi %d client %v: got %v, want %v", test.dpi, test.client, got, test.want)
		}
	}
}

func TestCaptionScreenPoint(t *testing.T) {
	bounds := captionRect{-1875, -50, -1825, -10}
	for _, test := range []struct {
		x, y int16
		want bool
	}{
		{-1875, -50, true},
		{-1826, -11, true},
		{-1825, -20, false},
		{-1850, -10, false},
		{-1876, -20, false},
		{-1850, -51, false},
	} {
		point := uintptr(uint16(test.x)) | uintptr(uint16(test.y))<<16
		if got := bounds.containsScreenPoint(point); got != test.want {
			t.Errorf("point (%d, %d): got %t, want %t", test.x, test.y, got, test.want)
		}
	}
}
