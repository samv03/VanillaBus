"""python3 -m can_engine --ipc <unix-socket-path>"""

from can_engine.server import main

if __name__ == "__main__":
    raise SystemExit(main())
