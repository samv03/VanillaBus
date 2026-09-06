"""Reserved for later SocketCAN open/list/close (bus.list / bus.open / bus.close).

T2 does not open a real interface. Requests are answered with engine.error
not_implemented by the IPC server.
"""


def list_buses() -> list[str]:
    """T1 placeholder — does not enumerate host CAN interfaces."""
    return []
