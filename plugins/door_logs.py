from neb.plugins import Plugin
from neb.engine import KeyValueStore

import pika
import json
import logging
import threading
import time
import humanize


class DoorLogPlugin(Plugin):
    """Allows for queries of the ENTS doors and sends broadcast messages
    door last [amount] : Lists the last [amount] of people to use the door. Default 1. Max 10.
    """

    name="door"

    def __init__(self, *args, **kwargs):
        super(DoorLogPlugin, self).__init__(*args, **kwargs)
        self.store = KeyValueStore("doors.json")

        if not self.store.has("mq"):
            self.store.set("mq", {
                "hostname": "",
                "port": 5672,
                "username": "",
                "password": "",
                "recv_queue": ""
            })

        if not self.store.has("rooms"):
            self.store.set("rooms", [])

        if not self.store.has("timeout"):
            self.store.set("timeout", 120) # seconds

        amqpUrl = "amqp://" + self.store.get('mq')['username'] + ":" + self.store.get('mq')['password'] + "@" + self.store.get('mq')["hostname"] + ":" + str(self.store.get("mq")["port"])
        self._consumer = MqConsumer(self.store.get('mq')['recv_queue'], amqpUrl, self._handle_message)

        self._startupTime = time.time()
        th = threading.Thread(target=self._consumer.start, args=[])
        th.daemon = True
        th.start()

        self._recentUnlocks = []

    def cmd_last(self, event, *args):
        """Shows the last few people to use the door (up to 10, default 1). 'door last [amount]'"""
        results = []
        amount = event["content"]["body"][10:].strip()
        if amount == '':
            amount = 1
        else:
            amount = int(amount)
        if amount > 10:
            amount = 10
        gotRecord = False
        for i in range(amount):
            logging.info("i = " + str(i))
            targetIdx = len(self._recentUnlocks) - i - 1
            if targetIdx < 0:
                break
            gotRecord = True
            record = self._recentUnlocks[targetIdx]
            results.append(record.nickname + "      " + humanize.naturaltime(time.time() - record.lastUnlock))
        if not gotRecord:
            results = ["No recent entries: Did I restart?"]
        elif amount > 1:
            results.append("-- end of list --")
        resultStr = ""
        for line in results:
            resultStr += line + "\n";
        return resultStr

    def _handle_message(self, body):
        self.checkRecentQueue()
        logging.debug("Got mesage: " + body)
        if time.time() - self._startupTime <= 15:
            logging.info("Skipping AMQP message: Recently started up")
            return
        body = json.loads(body)
        if(body["type"] == "UNLOCK_ATTEMPT" and body["permitted"] == True):
            for attempt in self._recentUnlocks:
                if attempt.fob == body["fobNumber"] and (time.time() - attempt.lastUnlock) < self.store.get('timeout'):
                    logging.info("Skipping announcement: Fob recently entered")
                    return # within cooldown - skip
            displayName = body["name"]
            self._recentUnlocks.append(UnlockAttempt(body["fobNumber"], displayName))
            if (body["announce"] == True):
                for room in self.store.get("rooms"):
                    if not room[0] == '!':
                        logging.warning("Skipping post to room '" + room + "': Not an internal room ID")
                        continue
                    self.matrix.send_notice(room, displayName + " entered the space")

    def checkRecentQueue(self):
        while len(self._recentUnlocks) > 25:
            self._recentUnlocks.pop(0)

class UnlockAttempt:
    def __init__(self, fob, nickname):
        self.fob = fob
        self.nickname = nickname
        self.lastUnlock = time.time()

class MqConsumer:
    def __init__(self, queueName, amqpUrl, callback):
        self._logger = logging.getLogger(__name__)
        self._callback = callback
        self._queueName = queueName
        self._amqpUrl = amqpUrl
        self._stopping = False
        self._channel = None
        self._connection = None

    def start(self):
        while(True):
            self._attempt_connection()

    def _attempt_connection(self):
        self._logger.info("Initiating connection...")
        self._connection = pika.SelectConnection(pika.URLParameters(self._amqpUrl),
                                                 on_open_callback=self.on_connection_open,
                                                 on_open_error_callback=self.on_connection_open_error,
                                                 on_close_callback=self.on_connection_error,
                                                 stop_ioloop_on_close=False)
        self._connection.ioloop.start()

    def on_connection_open(self, unused_connection):
        self._logger.info("Connection established")
        self._connection.channel(on_open_callback=self.on_channel_open)

    def on_connection_open_error(self, unused_connection, error_message):
        self._logger.warning("Failed to connect to MQ, reconnecting...")
        self._connection.ioloop.stop()
        self._attempt_connection()

    def on_connection_error(self, connection, reply_code, reply_text):
        if self._stopping:
            return
        self._logger.warning("Connection to MQ interrupted, reconnecting...")
        self._connection.ioloop.stop()
        #self._attempt_connection() # reconnection handled in start()

    def on_channel_open(self, channel):
        self._channel = channel
        self._channel.add_on_close_callback(self.on_channel_closed)
        self._channel.add_on_cancel_callback(self.on_consumer_cancelled)
        self._channel.basic_consume(self.on_message, self._queueName)

    def on_consumer_cancelled(self, method_frame):
        self._logger.warning("MQ server cancelled consumer")
        if self._channel:
            self._channel.close()

    def on_channel_closed(self, channel, reply_code, reply_text):
        if self._stopping:
            return
        self._logger.warning("Channel to MQ server was closed, reconnecting")
        self._connection.close()

    def on_message(self, unused_channel, basic_deliver, properties, body):
        self._callback(body)
        self._channel.basic_ack(basic_deliver.delivery_tag)

    def stop(self):
        self._stopping = True
        if self._channel:
            self._channel.close()
