package addons

import (
	_ "embed"
	"runtime"
)

// Everything an add-on install runs is pinned IN THIS BINARY (review
// blocker, final train part 1): the relay can only ask for these versions,
// never name a ref, URL or package of its own.

// UVVersion is the uv used for every add-on (astral-sh/uv release).
const UVVersion = "0.13.9"

// uvSHA256 are the sha256s of uv's release assets for UVVersion (from the
// release's .sha256 files, 2026-11-17). uv itself verifies the managed
// Python it downloads against checksums compiled into it.
var uvSHA256 = map[string]string{
	"uv-aarch64-apple-darwin.tar.gz":     "5aeca67f2283f75235de40d0bd9c0a5bbc5fce23b6d48b3bf9fa1b2db08382ca",
	"uv-x86_64-apple-darwin.tar.gz":      "617a3211261b0fc739562f0071aa34e9739797c510208ede8e2977c30903d041",
	"uv-x86_64-unknown-linux-gnu.tar.gz": "a7fbaff2b9a271d85c1bdb540941090fd1ce011797b4abeb48e4dcd39c2471d5",
}

// ArtemisCommit is the google/artemis commit installed (not on PyPI).
const ArtemisCommit = "351ca8422f7b5b54e80a9c1ce03a222e02415b6b"

// ArtemisTarballSHA256 is the sha256 of codeload's tarball of
// ArtemisCommit (identical on two downloads, 2026-11-17). Its uv.lock pins
// every dependency with hashes; `uv sync --frozen` installs exactly that.
const ArtemisTarballSHA256 = "8ad92b1e4ee293d64767204e73e20cdce1263a3208122e4b5c2645ec7b29ab50"

// artemisTarballSHA256 is what install checks (tests swap in their fixture).
var artemisTarballSHA256 = ArtemisTarballSHA256

// MobilerunVersion is the PyPI version installed.
const MobilerunVersion = "0.7.4"

// mobilerunRequirements: every package of mobilerun[anthropic]==0.7.4 with
// its hashes (`uv pip compile --universal --python-version 3.12
// --generate-hashes`). Installed with --require-hashes and binaries only,
// except apkutils2 (no wheel exists) which is built from its pinned sdist
// with the pinned build dependencies below.
//
//go:embed pins/mobilerun-requirements.txt
var mobilerunRequirements string

//go:embed pins/mobilerun-build-constraints.txt
var mobilerunBuildConstraints string

// PinnedVersion is the only version the relay may name for an add-on.
func PinnedVersion(name string) string {
	switch name {
	case Artemis:
		return ArtemisCommit[:12]
	case Mobilerun:
		return MobilerunVersion
	}
	return ""
}

// uvAsset names astral-sh/uv's release asset for this machine.
func uvAsset() string {
	arch := "aarch64"
	if runtime.GOARCH == "amd64" {
		arch = "x86_64"
	}
	if runtime.GOOS == "linux" {
		return "uv-" + arch + "-unknown-linux-gnu.tar.gz"
	}
	return "uv-" + arch + "-apple-darwin.tar.gz"
}
