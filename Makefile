# Run from the repository root. Each project owns its own dependencies and output.
SHELL := /bin/sh
HARDWARE_PYTHON ?= $(CURDIR)/hardware/.venv/bin/python
PIO ?= pio

.PHONY: help setup-hardware test-hardware export-hardware check-contract test-firmware build-firmware test-tui build-tui test-web website check

help:
	@printf '%s\n' \
	  'make setup-hardware  Install the pinned CAD/audit environment (requires uv)' \
	  'make test-hardware   Run mechanical Python regression tests' \
	  'make export-hardware Generate CAD in hardware/exports/' \
	  'make check-contract  Verify firmware constants against CAD parameters' \
	  'make test-firmware   Run native C++ sanitizer tests' \
	  'make build-firmware  Compile public ESP32 firmware (requires pio)' \
	  'make test-tui        Run Scala/Glyphora tests (requires JDK 25)' \
	  'make build-tui       Assemble the runnable terminal JAR' \
	  'make test-web        Run Node tests and fixture-backed browser integration' \
	  'make website         Fetch verified CAD assets and build the Pages artifact' \
	  'make check           Check formatting, asset rejection, and shared constants'

setup-hardware:
	uv venv --python 3.14 hardware/.venv
	uv pip sync --python hardware/.venv/bin/python hardware/requirements-audit.txt

test-hardware:
	cd hardware && $(HARDWARE_PYTHON) -m pytest -q

export-hardware:
	cd hardware && $(HARDWARE_PYTHON) -m cad.export

check-contract:
	python3 tools/contracts/firmware.py --check

test-firmware: check-contract
	python3 firmware/tools/test_native.py

build-firmware: check-contract
	$(PIO) run -d firmware -e public

test-tui:
	cd apps/tui && ./mill --no-server app.test

build-tui:
	cd apps/tui && ./mill --no-server app.assembly

website:
	npm run assets:fetch
	npm run build

# Run `make website` and `npx playwright install chromium` before integration tests.
test-web:
	npm test
	npm run test:browser

check: check-contract
	npm run format:check
	npm run test:assets
