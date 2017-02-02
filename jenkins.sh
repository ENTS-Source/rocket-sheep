#!/bin/bash

# clean up from any previous attempts first
rm -rf .tmp
mkdir .tmp

# copy the submodule files over
cp -r Matrix-NEB/* .tmp/

# apply all applicable patches
cd .tmp
for i in ../patches/*.patch; do patch -p1 < ${i}; done
cd ../

# copy over our plugins
cp -r plugins .tmp
cp requirements.txt .tmp/requirements.txt