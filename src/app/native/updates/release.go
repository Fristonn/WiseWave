package updates

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

const repository = "Fristonn/WiseWave"
const publicKey = "O/7SwqOR9Z8sn8xhp/YTzxtaA5oa2pAfNna+kZbOpAI="
const signatureMarker = "<!-- wisewave-installer-signatures"
const maxInstallerSize = 256 << 20

var versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$`)
var client = &http.Client{
	Timeout: 5 * time.Minute,
	CheckRedirect: func(request *http.Request, previous []*http.Request) error {
		host := request.URL.Hostname()
		if len(previous) >= 10 || request.URL.Scheme != "https" ||
			(host != "github.com" && host != "api.github.com" && !strings.HasSuffix(host, ".githubusercontent.com")) {
			return errors.New("unexpected github download redirect")
		}
		return nil
	},
}

type Release struct {
	Version string
	Notes   string
	asset   releaseAsset
	digest  [sha256.Size]byte
}

type releaseAsset struct {
	Name   string `json:"name"`
	URL    string `json:"browser_download_url"`
	Size   int64  `json:"size"`
	Digest string `json:"digest"`
}

func validArchitecture(arch string) bool { return arch == "amd64" || arch == "arm64" }

func versionParts(version string) []int {
	parts := versionPattern.FindStringSubmatch(version)
	if parts == nil {
		return nil
	}
	result := make([]int, 3)
	for i, part := range parts[1:] {
		result[i], _ = strconv.Atoi(part)
	}
	return result
}

func signatureMessage(version, arch string, digest []byte) []byte {
	return append([]byte("wisewave-installer\n"+version+"\n"+arch+"\n"), digest...)
}

func pinnedKey() ed25519.PublicKey {
	key, _ := base64.StdEncoding.DecodeString(publicKey)
	return ed25519.PublicKey(key)
}

func InstallerSignature(path, version, arch, encodedKey string) (string, error) {
	if versionParts(version) == nil || !validArchitecture(arch) {
		return "", errors.New("invalid installer version or architecture")
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encodedKey))
	if err != nil || len(key) != ed25519.PrivateKeySize || !slices.Equal(key[ed25519.SeedSize:], pinnedKey()) {
		return "", errors.New("invalid WiseWave release signing key")
	}
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, io.LimitReader(file, maxInstallerSize+1))
	if err != nil {
		return "", err
	}
	if size == 0 || size > maxInstallerSize {
		return "", errors.New("invalid installer size")
	}
	signature := ed25519.Sign(ed25519.PrivateKey(key), signatureMessage(version, arch, hash.Sum(nil)))
	return base64.StdEncoding.EncodeToString(signature), nil
}

func SignatureComment(amd64, arm64 string) string {
	return signatureMarker + "\namd64 " + amd64 + "\narm64 " + arm64 + "\n-->"
}

func open(ctx context.Context, url, accept string) (io.ReadCloser, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", accept)
	request.Header.Set("User-Agent", "WiseWave")
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("github returned status %d", response.StatusCode)
	}
	return response.Body, nil
}

func Check(ctx context.Context, current, arch string) (*Release, error) {
	installed := versionParts(current)
	if installed == nil || !validArchitecture(arch) {
		return nil, errors.New("invalid installed version or architecture")
	}
	body, err := open(ctx, "https://api.github.com/repos/"+repository+"/releases/latest", "application/vnd.github+json")
	if err != nil {
		return nil, err
	}
	defer body.Close()
	return readRelease(body, installed, arch)
}

func readRelease(body io.Reader, installed []int, arch string) (*Release, error) {
	var latest struct {
		Version    string         `json:"tag_name"`
		Body       string         `json:"body"`
		Draft      bool           `json:"draft"`
		Prerelease bool           `json:"prerelease"`
		Assets     []releaseAsset `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(body, 1<<20)).Decode(&latest); err != nil {
		return nil, err
	}
	version := versionParts(latest.Version)
	if version == nil || latest.Draft || latest.Prerelease {
		return nil, errors.New("invalid latest WiseWave release")
	}
	if slices.Compare(version, installed) <= 0 {
		return nil, nil
	}

	name := "wisewave-setup-" + arch + ".exe"
	expectedURL := "https://github.com/" + repository + "/releases/download/" + latest.Version + "/" + name
	for _, asset := range latest.Assets {
		if asset.Name != name || asset.URL != expectedURL || asset.Size <= 0 || asset.Size > maxInstallerSize {
			continue
		}
		digestText, ok := strings.CutPrefix(asset.Digest, "sha256:")
		digest, err := hex.DecodeString(digestText)
		if !ok || err != nil || len(digest) != sha256.Size {
			return nil, errors.New("missing github installer checksum")
		}
		notes, signature, err := releaseSignature(latest.Body, arch)
		if err != nil || !ed25519.Verify(pinnedKey(), signatureMessage(latest.Version, arch, digest), signature) {
			return nil, errors.New("invalid WiseWave installer signature")
		}
		return &Release{Version: latest.Version, Notes: notes, asset: asset, digest: [sha256.Size]byte(digest)}, nil
	}
	return nil, errors.New("missing Windows installer for this architecture")
}

func releaseSignature(body, arch string) (string, []byte, error) {
	notes, block, found := strings.Cut(body, signatureMarker)
	signatures, _, closed := strings.Cut(block, "-->")
	if found && closed {
		for line := range strings.SplitSeq(signatures, "\n") {
			if encoded, ok := strings.CutPrefix(strings.TrimSpace(line), arch+" "); ok {
				sig, err := base64.StdEncoding.DecodeString(encoded)
				notes = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(notes), "### what's new"))
				return notes, sig, err
			}
		}
	}
	return "", nil, errors.New("missing installer signature")
}

func (release *Release) Download(ctx context.Context, file io.Writer) error {
	body, err := open(ctx, release.asset.URL, "application/octet-stream")
	if err != nil {
		return err
	}
	defer body.Close()
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(file, hash), io.LimitReader(body, release.asset.Size+1))
	if err != nil {
		return err
	}
	if size != release.asset.Size || !slices.Equal(hash.Sum(nil), release.digest[:]) {
		return errors.New("downloaded installer did not match its signed checksum")
	}
	return nil
}
