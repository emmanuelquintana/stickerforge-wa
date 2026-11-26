package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

//go:embed payload.zip
var payload []byte

const version = "0.3.0"

var reader = bufio.NewReader(os.Stdin)

func ask(s string) string {
	fmt.Print(s)
	line, _ := reader.ReadString('\n')
	return strings.TrimSpace(line)
}
func run(dir, path string, args ...string) error {
	c := exec.Command(path, args...)
	c.Dir = dir
	c.Stdin = os.Stdin
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	return c.Run()
}
func addPath(p string) {
	if p != "" {
		os.Setenv("PATH", p+string(os.PathListSeparator)+os.Getenv("PATH"))
	}
}
func refreshPath() {
	// Read only PATH from the registry; no user input is interpolated in the command.
	if b, e := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`).Output(); e == nil {
		addPath(strings.TrimSpace(string(b)))
	}
	for _, p := range []string{filepath.Join(os.Getenv("ProgramFiles"), "nodejs"), filepath.Join(os.Getenv("ProgramFiles"), "Git", "cmd"), filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "WinGet", "Links"), filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "WindowsApps")} {
		addPath(p)
	}
}
func extract(dir string) error {
	z, e := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if e != nil {
		return e
	}
	for _, f := range z.File {
		dest := filepath.Join(dir, filepath.FromSlash(f.Name))
		rel, e := filepath.Rel(dir, dest)
		if e != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
			return errors.New("ruta invalida")
		}
		if f.FileInfo().IsDir() {
			continue
		}
		if e = os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
			return e
		}
		r, e := f.Open()
		if e != nil {
			return e
		}
		w, e := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
		if e != nil {
			r.Close()
			return e
		}
		_, e = io.Copy(w, r)
		ce := w.Close()
		r.Close()
		if e != nil {
			return e
		}
		if ce != nil {
			return ce
		}
	}
	return nil
}
func ensure(dir, bin, id string) error {
	refreshPath()
	if _, e := exec.LookPath(bin); e == nil {
		return nil
	}
	if strings.ToLower(ask("Falta "+bin+". Instalar "+id+" mediante WinGet? [s/N]: ")) != "s" {
		return fmt.Errorf("instalacion cancelada: %s", bin)
	}
	winget, e := exec.LookPath("winget.exe")
	if e != nil {
		return errors.New("WinGet no disponible. Instala App Installer de Microsoft Store.")
	}
	if e = run(dir, winget, "install", "--id", id, "--exact", "--source", "winget"); e != nil {
		return e
	}
	refreshPath()
	if _, e = exec.LookPath(bin); e != nil {
		return fmt.Errorf("%s no aparece en PATH. Cierra y abre el EXE tras instalarlo", bin)
	}
	return nil
}
func start() error {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		return errors.New("LOCALAPPDATA no disponible")
	}
	root := filepath.Join(local, "StickerForgeWA")
	app := filepath.Join(root, "app-"+version)
	if e := os.MkdirAll(app, 0700); e != nil {
		return e
	}
	if e := extract(app); e != nil {
		return e
	}
	env := filepath.Join(root, ".env")
	if _, e := os.Stat(env); os.IsNotExist(e) {
		b, e := os.ReadFile(filepath.Join(app, ".env.example"))
		if e != nil {
			return e
		}
		if e = os.WriteFile(env, b, 0600); e != nil {
			return e
		}
	}
	os.Setenv("SESSION_DIR", filepath.Join(root, "session"))
	refreshPath()
	fmt.Println("StickerForge WA", version, "| Windows x64\nDatos privados:", root)
	fmt.Println("Cliente no oficial: usa una cuenta secundaria. No compartas el QR ni la carpeta session.")
	for {
		switch strings.ToLower(ask("\n[1] Iniciar bot  [2] Configurar usuarios  [3] Abrir carpeta  [4] Salir\nOpcion: ")) {
		case "1":
			for _, p := range [][2]string{{"node.exe", "OpenJS.NodeJS.LTS"}, {"git.exe", "Git.Git"}, {"ffmpeg.exe", "Gyan.FFmpeg"}} {
				if e := ensure(app, p[0], p[1]); e != nil {
					return e
				}
			}
			if _, e := exec.LookPath("ffprobe.exe"); e != nil {
				return errors.New("FFprobe no encontrado; revisa la instalacion de FFmpeg")
			}
			if _, e := exec.LookPath("yt-dlp.exe"); e != nil {
				if strings.ToLower(ask("Instalar descarga de enlaces (yt-dlp)? [s/N]: ")) == "s" {
					if e = ensure(app, "yt-dlp.exe", "yt-dlp.yt-dlp"); e != nil {
						return e
					}
				}
			}
			node, _ := exec.LookPath("node.exe")
			npm := filepath.Join(filepath.Dir(node), "node_modules", "npm", "bin", "npm-cli.js")
			if _, e := os.Stat(npm); e != nil {
				return errors.New("No se encontro npm junto a Node.js. Instala la distribucion oficial de Node.js LTS.")
			}
			if e := run(app, node, "-e", `const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<12))process.exit(1)`); e != nil {
				return errors.New("Node.js 22.12 o superior requerido")
			}
			marker := filepath.Join(app, ".installed")
			if _, e := os.Stat(marker); e != nil {
				fmt.Println("Se instalaran dependencias npm desde el registro oficial; revisa el codigo antes de aceptar.")
				if strings.ToLower(ask("Continuar? [s/N]: ")) != "s" {
					return errors.New("Instalacion cancelada")
				}
				args := []string{npm, "install", "--omit=dev", "--no-fund", "--registry=https://registry.npmjs.org/"}
				if _, e := os.Stat(filepath.Join(app, "package-lock.json")); e == nil {
					args[1] = "ci"
				}
				if e := run(app, node, args...); e != nil {
					return e
				}
				if e := os.WriteFile(marker, []byte(version), 0600); e != nil {
					return e
				}
			}
			if e := run(root, node, "--env-file-if-exists="+env, filepath.Join(app, "src", "bot.mjs")); e != nil {
				fmt.Println("El bot termino:", e)
			}
		case "2":
			if e := run(root, "notepad.exe", env); e != nil {
				fmt.Println(e)
			}
		case "3":
			if e := run(root, "explorer.exe", root); e != nil {
				fmt.Println(e)
			}
		case "4", "":
			return nil
		default:
			fmt.Println("Opcion no valida")
		}
	}
}
func main() {
	if len(os.Args) > 1 && os.Args[1] == "--version" {
		fmt.Println(version)
		return
	}
	if e := start(); e != nil {
		fmt.Println("Error:", e)
		ask("Pulsa Enter para cerrar.")
		os.Exit(1)
	}
}
