from neb.plugins import Plugin
from neb.engine import KeyValueStore
from requests.auth import HTTPBasicAuth
from io import StringIO

import logging as log
import requests


class CameraCheckPlugin(Plugin):
    """Replies with information about the cameras at ENTS
    camera list : Lists the available cameras
    camera show <name> : Captures the current image from the given camera
    """

    name="camera"

    def __init__(self, *args, **kwargs):
        super(CameraCheckPlugin, self).__init__(*args, **kwargs)
        self.store = KeyValueStore("cameras.json")

        if not self.store.has("api"):
            self.store.set("api", {
                "base_url": "",
                "username": "",
                "password": ""
            })

        if not self.store.has("cameras"):
            self.store.set("cameras", {
                "MAINROOM": {
                    "name": "workspace",
                    "aliases": ['mainroom'],
                    "description": "The general work area"
                }
            })

    def cmd_list(self, event, *args):
        """Lists available cameras. 'camera list'"""
        results = []
        for shortcode in self.store.get("cameras").keys():
            camera = self.store.get("cameras")[shortcode]
            results.append(camera["name"] + ": " + camera["description"])
        return results

    def cmd_show(self, event, *args):
        """Gets the current camera image. 'camera show <name>'"""
        targetName = event["content"]["body"][13:].lower().strip()
        targetShortcode = None
        for shortcode in self.store.get("cameras").keys():
            camera = self.store.get("cameras")[shortcode]
            if camera["name"].lower() == targetName:
                targetShortcode = shortcode
                break
            for alias in camera["aliases"]:
                if alias.lower() == targetName:
                    targetShortcode = shortcode
                    break
        if targetShortcode == None:
            return "Camera %s not found" % targetName
        else:
            return self.get_image(targetShortcode)

    def get_image(self, shortcode):
        apiInfo = self.store.get("api")
        url = apiInfo["base_url"] + "/image/" + shortcode + "?q=40"
        result = requests.get(url, auth=HTTPBasicAuth(apiInfo["username"], apiInfo["password"]), stream=True)
        #capture = Image.open(StringIO(result.content))
        response = self.matrix.media_upload(result.content, "image/jpeg")
        if "content_uri" in response:
            return {
                "msgtype": "m.image",
                "url": response["content_uri"],
                "body": shortcode + ".jpg",
                "info": {
                    "mimetype": "image/jpeg",
                    "size": len(result.content)
                }
            }
        else:
            return "Failed to upload image"
