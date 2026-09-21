#!/bin/bash
cd ~/apps/reqcore
docker compose up -d
echo "Reqcore started. Check: docker compose logs app --tail 20"
