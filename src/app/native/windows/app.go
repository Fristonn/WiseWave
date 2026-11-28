package windows

import (
	"context"
	"errors"
	"log"
	"runtime"

	"github.com/egoist/mygo"
	spotifyaccount "wisewave-runtime/desktop/accounts/Spotify"
	"wisewave-runtime/desktop/integrations"
	"wisewave-runtime/desktop/player"
	"wisewave/src/app/native/accounts/Spotify"
	"wisewave/src/app/native/accounts/YouTube"
	"wisewave/src/app/native/identity"
	"wisewave/src/app/native/system"
	"wisewave/src/app/native/tokens"
)

func Run(icon []byte) {
	identity.Init()
	mygo.App.SetName("WiseWave")
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	var engine *tokens.Engine
	music := player.NewMusicWithTokens(func(ctx context.Context, videoID, visitor string) (string, string, error) {
		if engine == nil {
			return "", "", errors.New("token engine unavailable")
		}
		return engine.Tokens(ctx, videoID, visitor)
	})
	mini := &MiniWindow{}
	trayControl := &TrayControl{mini: mini, updates: &installerUpdates{}}
	caption := &CaptionControls{}
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) {
		trayControl.quitting.Store(true)
	})
	mygo.App.OnSecondInstance(func([]string, string) {
		if trayControl.window != nil {
			if err := trayControl.Action("open"); err != nil {
				log.Printf("show existing window: %v", err)
			}
		}
	})
	playback := player.NewPlayback(music)
	trayControl.minimizeToTray.Store(true)
	discord := integrations.NewDiscord()
	mediaSession := integrations.NewMediaSession(playback)
	spotifyAccount := spotifyaccount.NewSpotifyAccount()
	spotifyaccount.WireSpotifySearch(spotifyAccount, music.Search)
	spotifyLogin := spotify.NewSpotifyLogin(spotifyAccount)
	youtubeAccount := player.NewYouTubeAccount(music)
	youtubeLogin := youtube.NewYouTubeLogin(youtubeAccount)
	mygo.Bind(music, playback, trayControl, caption, mini, discord, mediaSession, spotifyAccount, spotifyLogin, youtubeAccount, youtubeLogin, &system.Clipboard{})
	if err := mygo.Protocol.Handle("audio", player.Audio{Music: music}); err != nil {
		log.Fatal(err)
	}
	mygo.App.WhenReady(func() {
		engine = tokens.New()
		page := mygo.PageOptions{BackgroundThrottling: mygo.ThrottlingOff}
		if !mygo.IsDev() {
			page.DevTools = mygo.DevToolsDisabled
			page.PreloadScript = `window.addEventListener("contextmenu", event => event.preventDefault(), true);`
		}
		startMinimized := mygo.App.WasOpenedAtLogin() && startupMinimized()
		width, height := 1180, 760
		if runtime.GOOS == "windows" {
			area := mygo.Screen.PrimaryDisplay().WorkArea
			if area.Width > 0 && area.Height > 0 {
				width = max(900, min(width, area.Width-32))
				height = max(600, min(height, area.Height-32))
			}
		}
		window := mygo.NewWindow(mygo.WindowOptions{
			Title:             "WiseWave",
			Width:             width,
			Height:            height,
			MinWidth:          900,
			MinHeight:         600,
			Maximized:         true,
			Hidden:            startMinimized,
			URL:               "/",
			BackgroundColor:   "#111113",
			TitleBarStyle:     mygo.TitleBarHidden,
			TitleBarHeight:    80,
			HideWindowButtons: runtime.GOOS == "windows",
			Page:              page,
		})
		window.Page().OnContextMenu(func(e *mygo.ContextMenuEvent) {
			e.PreventDefault()
		})
		window.SetWindowButtonsTheme(mygo.ThemeDark)
		trayControl.window = window
		go trayControl.updates.start(window)
		caption.attach(window)
		window.OnLeaveFullScreen(func() {
			if trayControl.playerFullscreen {
				if err := PlayerFullscreenChanged.Emit(window, false); err != nil {
					log.Printf("leave player full screen: %v", err)
				}
			}
		})
		show := func() {
			if err := trayControl.Action("open"); err != nil {
				log.Printf("show window: %v", err)
			}
		}
		tray, err := mygo.NewTray(mygo.TrayOptions{
			ID: "wisewave", Icon: icon, ToolTip: "WiseWave",
		})
		if err != nil {
			log.Printf("system tray unavailable: %v", err)
		} else {
			trayControl.tray = tray
			tray.OnClick(show)
			tray.OnRightClick(func() {
				if err := showTrayMenu(trayControl); err != nil {
					log.Printf("tray menu: %v", err)
				}
			})
		}
		window.OnMinimize(func() {
			if trayControl.miniWhenMinimized.Load() && !mini.isOpen() {
				trayControl.autoMini.Store(true)
				mini.Open()
			}
		})
		window.OnRestore(func() {
			if trayControl.autoMini.Swap(false) {
				mini.Close()
			}
		})
		window.OnClose(func(event *mygo.CloseEvent) {
			if !trayControl.quitting.Load() && trayControl.tray != nil && trayControl.minimizeToTray.Load() {
				event.PreventDefault()
				window.Hide()
			} else if !trayControl.quitting.Load() {
				trayControl.quitting.Store(true)
				mygo.App.Quit()
			}
		})
		if startMinimized {
			window.Minimize()
		}
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
	if err := trayControl.updates.launch(); err != nil {
		log.Printf("launch update installer: %v", err)
	}
}
