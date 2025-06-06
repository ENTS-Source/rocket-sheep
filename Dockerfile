FROM node:20
COPY ./ /app
WORKDIR /app
RUN npm install && npm run-script build
VOLUME /data
CMD node build/app/sheep.js
