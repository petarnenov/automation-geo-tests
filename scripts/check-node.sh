#!/bin/sh
# Make sure Node is installed in the version .nvmrc names, before anything
# that needs Node runs (make doctor, make setup). Plain sh on purpose:
# scripts/doctor.js cannot report a missing Node. On failure, prints the
# install commands for this OS and exits 1.

cd "$(dirname "$0")/.." || exit 1
want=$(tr -dc '0-9' < .nvmrc)

have=''
if command -v node >/dev/null 2>&1; then
  have=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)
fi
[ "$have" = "$want" ] && exit 0

red() { if [ -t 1 ]; then printf '\033[31m%s\033[0m\n' "$1"; else echo "$1"; fi; }
if [ -z "$have" ]; then
  red "✘ Node not found (needs Node $want)"
else
  red "✘ Node $(node -v) found, needs Node $want"
fi
echo

nvm_install="curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash"

if [ -n "$NVM_DIR" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
  echo "nvm is installed. Switch to Node $want:"
  echo "  nvm install        (reads .nvmrc)"
  echo "  nvm use"
  echo
  echo "Then run: make setup"
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    echo "macOS — either:"
    echo "  brew install node@$want && brew link --overwrite --force node@$want"
    echo "or with nvm (recommended, lets you switch versions):"
    echo "  $nvm_install"
    echo "  # open a new terminal, then in this repo:"
    echo "  nvm install"
    ;;
  Linux)
    echo "Linux — with nvm (recommended, no sudo, lets you switch versions):"
    echo "  $nvm_install"
    echo "  # open a new terminal, then in this repo:"
    echo "  nvm install"
    if command -v apt-get >/dev/null 2>&1; then
      echo "or system-wide on Debian/Ubuntu:"
      echo "  curl -fsSL https://deb.nodesource.com/setup_$want.x | sudo -E bash -"
      echo "  sudo apt-get install -y nodejs"
    elif command -v dnf >/dev/null 2>&1; then
      echo "or system-wide on Fedora/RHEL:"
      echo "  curl -fsSL https://rpm.nodesource.com/setup_$want.x | sudo bash -"
      echo "  sudo dnf install -y nodejs"
    fi
    ;;
  *)
    echo "Install Node $want from https://nodejs.org/en/download"
    ;;
esac
echo
echo "Then run: make setup"
exit 1
