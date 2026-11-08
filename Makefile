# Convenience targets. Everything also works without make; see README.md.
PYTHON ?= python3

.PHONY: run test test-browser demo screenshots check

run:            ## serve the app at http://localhost:8765/
	$(PYTHON) tools/serve.py

test:           ## unit tests (browser tests run too when Playwright is installed)
	$(PYTHON) -m unittest discover -s tests -v

demo:           ## regenerate app/demo.json from songs/amazing_grace.txt
	$(PYTHON) tools/txt2song.py songs/amazing_grace.txt app/demo.json

screenshots:    ## regenerate docs/screenshots (needs Playwright)
	$(PYTHON) tools/screenshots.py

check:          ## syntax-check the app and compile every bundled song
	node --check app/app.js
	for f in songs/*.txt; do $(PYTHON) tools/txt2song.py "$$f" /dev/null || exit 1; done
