package main

import (
	"errors"
	"log"
	"os"
	"strings"

	"wisewave/src/app/native/updates"
)

func writeReleaseNotes(version, amd64, arm64, target string) error {
	changelog, err := os.ReadFile("CHANGELOG.md")
	if err != nil {
		return err
	}
	markdown := "\n" + strings.ReplaceAll(string(changelog), "\r\n", "\n")
	_, section, found := strings.Cut(markdown, "\n## "+version+"\n")
	notes, _, _ := strings.Cut(section, "\n## ")
	notes = strings.TrimSpace(notes)
	if !found || notes == "" {
		return errors.New("missing release notes for " + version)
	}
	key := os.Getenv("MYGO_UPDATER_PRIVATE_KEY")
	amd64Signature, err := updates.InstallerSignature(amd64, version, "amd64", key)
	if err != nil {
		return err
	}
	arm64Signature, err := updates.InstallerSignature(arm64, version, "arm64", key)
	if err != nil {
		return err
	}
	body := "### what's new\n\n" + notes + "\n\n" + updates.SignatureComment(amd64Signature, arm64Signature) + "\n"
	return os.WriteFile(target, []byte(body), 0600)
}

func main() {
	if len(os.Args) != 5 {
		log.Fatal("usage: release-notes version amd64-installer arm64-installer notes-file")
	}
	if err := writeReleaseNotes(os.Args[1], os.Args[2], os.Args[3], os.Args[4]); err != nil {
		log.Fatal(err)
	}
}
