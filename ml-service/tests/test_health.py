def test_health_reports_every_model(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["service"] == "ml-service"
    assert body["status"] in {"ok", "degraded"}
    for name in ("crop", "fertilizer", "disease"):
        assert name in body["models"]
        assert "loaded" in body["models"][name]
