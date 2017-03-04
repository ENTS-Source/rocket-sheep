from neb.plugins import Plugin
from neb.engine import KeyValueStore
from math import ceil

import requests


class VotePlugin(Plugin):
    """Let's make decisions together
    vote on <issue> : start a vote on <issue>. Eg: !vote on painting the shed red
    vote agree : agree with <issue>
    vote disagree : disagree with <issue>
    vote abstain [reason] : prefer to abstain from the vote for [reason]
    vote status : get general information about the vote in progress
    vote cancel [reason] : cancel the current vote for [reason]
    """

    name = "vote"
    currentVote = None
    lastVote = None

    def __init__(self, *args, **kwargs):
        super(VotePlugin, self).__init__(*args, **kwargs)
        self.store = KeyValueStore("vote.json")

        if not self.store.has("allowed_rooms"):
            self.store.set("allowed_rooms", [])
        if not self.store.has("president_mxid"):
            self.store.set("president_mxid", "")
        if not self.store.has("voters"):
            self.store.set("voters", [])
        if not self.store.has("usermap"):
            self.store.set("usermap", {})

    def map_user(self, user):
        if user in self.store.get("usermap"):
            return self.store.get("usermap")[user]
        return user

    def check_completed(self):
        majority = ceil(len(self.store.get("voters")) / 2.0)
        agree = 0
        counted = 0
        president_voted = False
        for voter in self.currentVote["responses"].keys():
            if voter == self.store.get("president_mxid"):
                president_voted = True
                continue
            counted += 1
            response = self.currentVote["responses"][voter]
            if response.startswith("agree"):
                agree += 1
        if counted < len(self.store.get("voters")) - 1:  # exclude president, so -1
            return agree >= majority
        elif counted == len(self.store.get("voters")) - 1:
            return president_voted or agree >= majority
        return True

    def print_status(self, for_vote):
        if for_vote is None:
            for_vote = self.currentVote
        if for_vote is None:
            return "No vote in memory to show"
        majority = ceil(len(self.store.get("voters")) / 2.0)
        votes = {
            "agree": 0,
            "disagree": 0
        }
        abstain_count = 0
        counted = 0
        president_agree = False
        president_voted = False
        for voter in for_vote["responses"].keys():
            vote = for_vote["responses"][voter]
            if voter == self.store.get("president_mxid"):
                president_agree = vote.startswith("agree")
                president_voted = True
                continue
            counted += 1
            if vote in votes.keys():
                votes[vote] += 1
            else:
                votes[vote] = 1
            if vote.startswith("abstain"):
                abstain_count += 1
        status = "Voting on: " + for_vote["issue"] + '\n'
        status += "Started by: " + for_vote["started_by"] + '\n'
        status += "%i votes recorded, %i is majority\n" % (counted, majority)
        status += "%i agree, %i disagree, %i abstain\n" % (votes["agree"], votes["disagree"], abstain_count)
        if votes["agree"] >= majority:
            status += "=== MAJORITY REACHED: VOTE PASSED ===\n"
        elif votes["agree"] + (1 if president_agree else 0) >= majority and counted == len(self.store.get("voters")) - 1:
            status += "=== MAJORITY REACHED: VOTE PASSED ====\nTie-breaker from president was used.\n"
        elif counted < len(self.store.get("voters")) - 1:
            if for_vote["canceled"]:
                status += "=== VOTE CANCELED ===\n"
                if len(for_vote["cancel_reason"]) > 0:
                    status += "Cancel reason: " + for_vote["cancel_reason"] + '\n'
            else:
                status += "Vote still in progress.\n"
        elif president_voted or votes["disagree"] >= majority:
            status += "=== VOTE FAILED: Majority not reached ===\n"
        else:
            status += "Waiting for president's vote.\n"
        status += "\n"
        for key in votes.keys():
            count = votes[key]
            status += "%i - %s\n" % (count, key)
        return status.strip()

    def record_vote(self, sender, vote):
        sender = self.map_user(sender)
        if self.currentVote is None:
            return "A vote is currently not in progress. See !vote status"
        if sender not in self.store.get("voters"):
            return "%s is not a registered voter - ignoring vote" % sender
        last_response = (None if sender not in self.currentVote["responses"] else self.currentVote["responses"][sender])
        self.currentVote["responses"][sender] = vote
        if self.check_completed():
            self.lastVote = self.currentVote
            self.currentVote = None
            return self.print_status(self.lastVote)
        if last_response is not None:
            return "Vote changed for %s from %s to %s" % (sender, last_response, vote)
        if self.store.get("president_mxid") == sender:
            return "Vote recorded for %s, but does not count unless there is a tie breaker needed" % sender
        return "Vote recorded for %s" % sender

    def cmd_status(self, event, *args):
        """"Prints status about the current vote, or the last vote if available. 'vote status'"""
        if self.currentVote is not None:
            return self.print_status(self.currentVote)
        return self.print_status(self.lastVote)  # automatically handles None case

    def cmd_cancel(self, event, *args):
        """"Cancels the current vote. 'vote cancel [reason]'"""
        if self.currentVote is None:
            return "No vote currently in progress. See !vote status"
        if self.currentVote["started_by"] != event["sender"]:
            return "Sorry, only the initiator can cancel the vote. See !vote status"
        self.currentVote["canceled"] = True
        self.currentVote["cancel_reason"] = event["content"]["body"][12:].strip()
        self.lastVote = self.currentVote
        self.currentVote = None
        return self.print_status(self.lastVote)

    def cmd_on(self, event, *args):
        """Starts a vote on a particular issue for discussion. 'vote on <issue>'"""
        if event["room_id"] not in self.store.get("allowed_rooms"):
            return "Voting is not allowed in this room."
        if self.currentVote is not None:
            return "A vote is currently in progress. See !vote status"
        issue = event["content"]["body"][8:].strip()
        if len(issue) <= 0:
            return "No issue supplied. Syntax: !vote on <issue>"
        self.currentVote = {
            "started_by": event["sender"],
            "issue": issue,
            "responses": {},
            "canceled": False,
            "cancel_reason": ""
        }
        return "Vote started. Use !vote agree or !vote disagree to respond."

    def cmd_agree(self, event, *args):
        """Agrees to the current vote. 'vote agree'"""
        return self.record_vote(event["sender"], "agree")

    def cmd_disagree(self, event, *args):
        """Disagrees to the current vote. 'vote disagree'"""
        return self.record_vote(event["sender"], "disagree")

    def cmd_abstain(self, event, *args):
        """Abstains from the current vote. 'vote abstain'"""
        reason = event["content"]["body"][13:].strip()
        vote = "abstain"
        if len(reason):
            vote = "abstain (%s)" % reason
        return self.record_vote(event["sender"], vote)
