#!/usr/bin/env bash
# 把当前检出（含云端分支）构建并更新线上容器 read-life。
# 依赖：本机可用 ssh 登录 Host aliyun（root@118.178.242.59），且线上已有同名容器。
# 不覆盖容器的数据卷 /data。
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
host=${READ_LIFE_SSH:-aliyun}
container=${READ_LIFE_CONTAINER:-read-life}
cd "$root"
npm run build
stage=$(mktemp -d)
COPYFILE_DISABLE=1 tar -C "$root" -czf "$stage/release.tgz" dist src
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT
ssh -o BatchMode=yes "$host" "rm -rf /tmp/read-life-release && mkdir -p /tmp/read-life-release"
scp -o BatchMode=yes "$stage/release.tgz" "$host:/tmp/read-life-release.tgz"
ssh -o BatchMode=yes "$host" "tar -xzf /tmp/read-life-release.tgz -C /tmp/read-life-release && docker cp /tmp/read-life-release/dist/. $container:/app/dist/ && docker cp /tmp/read-life-release/src/. $container:/app/src/ && docker restart $container && rm -rf /tmp/read-life-release /tmp/read-life-release.tgz"
echo "已更新 $container，等待进程起来"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 5 https://read-life.aikipedia.cn/api/auth/me >/dev/null; then
    echo "线上已响应 https://read-life.aikipedia.cn/"
    exit 0
  fi
  sleep 2
done
echo "容器已重启，但公网还没有在限定时间内响应" >&2
exit 1
