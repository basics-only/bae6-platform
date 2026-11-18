#!/usr/bin/env bash
# P0 gate: hello on 1 then 3 replicas in kind; negative auth; load spread; no failed
# requests while a pod is killed and during a rolling restart.
# Usage: dev/kind/smoke.sh   (needs docker, kind, helm, kubectl)
set -euo pipefail
cd "$(dirname "$0")/../.."

CLUSTER=${CLUSTER:-bae6-dev}
NS=bae6-dev
CHART=charts/bae6-service
CTX="kind-$CLUSTER"
k() { kubectl --context "$CTX" -n "$NS" "$@"; }
in_probe() { k exec probe -- sh -c "$1"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

kind get clusters | grep -qx "$CLUSTER" || kind create cluster --name "$CLUSTER" --wait 120s

for app in examples/hello dev/mock-oidc; do
  name=$(basename "$app")
  docker build -q --build-arg APP="$app" -t "bae6/$name:dev" .
  kind load docker-image --name "$CLUSTER" "bae6/$name:dev"
done

kubectl --context "$CTX" create namespace "$NS" --dry-run=client -o yaml | kubectl --context "$CTX" apply -f -
helm --kube-context "$CTX" -n "$NS" upgrade --install mock-oidc "$CHART" -f dev/kind/mock-oidc.values.yaml --wait --timeout 120s
helm --kube-context "$CTX" -n "$NS" upgrade --install hello "$CHART" -f dev/kind/hello.values.yaml --set replicas=1 --wait --timeout 120s
echo "ok: 1 replica ready"
helm --kube-context "$CTX" -n "$NS" upgrade --install hello "$CHART" -f dev/kind/hello.values.yaml --set replicas=3 --wait --timeout 120s
echo "ok: scaled to 3 replicas"
[ "$(k get pods -l app.kubernetes.io/name=hello --field-selector=status.phase=Running -o name | wc -l | tr -d ' ')" = 3 ] || fail "expected 3 running pods"

k delete pod probe --ignore-not-found --wait
k run probe --image=curlimages/curl:8.11.1 --labels=bae6-dev/probe=true --restart=Never --command -- sleep 3600
k wait --for=condition=Ready pod/probe --timeout=90s

TOKEN=$(in_probe "curl -sf -X POST http://mock-oidc/token -d '{\"sub\":\"alice\",\"aud\":\"hello\",\"ttlSeconds\":900}'" | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
[ -n "$TOKEN" ] || fail "no token from mock-oidc"
WRONG_AUD=$(in_probe "curl -sf -X POST http://mock-oidc/token -d '{\"sub\":\"alice\",\"aud\":\"other\"}'" | sed -E 's/.*"access_token":"([^"]+)".*/\1/')

code() { in_probe "curl -s -o /dev/null -w '%{http_code}' $1 http://hello/v1/hello"; }
[ "$(code '')" = 401 ] || fail "no token must be 401"
[ "$(code "-H 'authorization: Bearer $WRONG_AUD'")" = 401 ] || fail "wrong audience must be 401"
[ "$(code "-H 'authorization: Bearer $TOKEN'")" = 200 ] || fail "valid token must be 200"
echo "ok: negative auth"

# New connection per request, so kube-proxy spreads them.
PODS=$(in_probe "for i in \$(seq 1 60); do curl -s -H 'authorization: Bearer $TOKEN' http://hello/v1/hello; echo; done" \
  | sed -nE 's/.*"pod":"([^"]+)".*/\1/p' | sort -u | wc -l | tr -d ' ')
[ "$PODS" = 3 ] || fail "expected responses from 3 pods, got $PODS"
echo "ok: responses from 3 pods"

# Steady traffic while one pod is killed and then the whole deployment rolls.
LOAD="for i in \$(seq 1 400); do curl -s -o /dev/null -m 5 -w '%{http_code}\n' -H 'authorization: Bearer $TOKEN' http://hello/v1/hello; sleep 0.05; done"
CODES=$(mktemp)
in_probe "$LOAD" > "$CODES" &
LOAD_PID=$!
sleep 2
k delete "$(k get pods -l app.kubernetes.io/name=hello -o name | head -n1)" --wait=false
sleep 6
k rollout restart deployment/hello
k rollout status deployment/hello --timeout=180s
wait "$LOAD_PID"
TOTAL=$(wc -l < "$CODES" | tr -d ' ')
BAD=$(grep -vc '^200$' "$CODES" || true)
rm -f "$CODES"
[ "$BAD" = 0 ] || fail "$BAD of $TOTAL requests failed during pod kill and rolling restart"
echo "ok: $TOTAL requests, none failed, during pod kill and rolling restart"

k delete pod probe --wait=false
echo "PASS"
