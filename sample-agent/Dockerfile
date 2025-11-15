FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY server.js .

ENV PORT=4000
ENV BASE_URL=http://localhost:4000

EXPOSE 4000

CMD ["npm", "start"]
