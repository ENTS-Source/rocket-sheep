from neb.plugins import Plugin
from neb.engine import KeyValueStore

import requests


class PingPlugin(Plugin):
    """Pings the space to let people know to check the chat
    ping space : Pings the space
    """

    name="ping"

    def __init__(self, *args, **kwargs):
        super(PingPlugin, self).__init__(*args, **kwargs)
        self.store = KeyValueStore("ping.json")

        if not self.store.has("url"):
            self.store.set("url", "http://localhost:80")

    def cmd_space(self, event, *args):
        """Pings the space to let people know to check the chat. 'ping space'"""
        response = requests.get(self.store.get('url'))
        if response.text == "played":
            return "Space pinged"
        else:
            return "Ping on cooldown - please try again later"
