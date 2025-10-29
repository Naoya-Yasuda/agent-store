.PHONY: start-temporal stop-temporal worker client

start-temporal:
	docker compose up -d

stop-temporal:
	docker compose down

worker:
	pnpm start:dev

client:
	pnpm ts-node src/client.ts

setup-aisev:
	../scripts/setup_aisev.sh
