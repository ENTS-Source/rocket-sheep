# rocket-sheep

[![Greenkeeper badge](https://badges.greenkeeper.io/ENTS-Source/rocket-sheep.svg)](https://greenkeeper.io/) 
[![TravisCI badge](https://travis-ci.org/ENTS-Source/rocket-sheep.svg?branch=master)](https://travis-ci.org/ENTS-Source/rocket-sheep)

A bot running on tang.ents.ca to help with member actions: `@sheep:tang.ents.ca`. Currently supports querying cameras at ENTS and announcing when people arrive.

# Running

* Clone this repository
* Run `npm install` in the cloned directory
* Copy `config/default.yaml` to `config/production.yaml` and change any settings.
* Run `NODE_ENV=production npm run build`
* Run `NODE_ENV=production npm run start`
