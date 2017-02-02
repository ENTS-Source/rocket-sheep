#!/bin/bash

./jenkins.sh
cp .bot/*.json .tmp/
rm -rf .bot
mv .tmp .bot
cd .bot
../env/Scripts/python setup.py install
../env/Scripts/pip install -r ../requirements.txt
../env/Scripts/python neb.py -c neb.json
read -rsp $'Press enter to continue...\n'
