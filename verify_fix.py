import urllib.request
import json
import time
import sys

BASE_URL = "http://localhost:8080"

def create_submission():
    url = f"{BASE_URL}/api/submissions/"
    payload = {
        "agent_id": "placeholder",
        "agent_card_url": "http://sample-agent:4000/agent-card.json",
        "endpoint_manifest": {"endpoints": []},
        "endpoint_snapshot_hash": "sha256:mock",
        "signature_bundle": {"signature": "mock"},
        "organization_meta": {"name": "Mock Org"}
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )

    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data['id']
    except urllib.error.HTTPError as e:
        print(f"Failed to create submission: {e.code} {e.reason}")
        print(e.read().decode('utf-8'))
        sys.exit(1)
    except Exception as e:
        print(f"Error creating submission: {e}")
        sys.exit(1)

def check_for_yellow_state(submission_id):
    urls = [
        f"{BASE_URL}/admin/review/{submission_id}",
        f"{BASE_URL}/submissions/{submission_id}/status"
    ]

    for url in urls:
        print(f"Polling {url}...")

        start_time = time.time()
        success = False
        # Poll for up to 30 seconds
        while time.time() - start_time < 30:
            try:
                with urllib.request.urlopen(url) as response:
                    html = response.read().decode('utf-8')

                    # Check for the yellow class
                    if "bg-yellow-100" in html:
                        print(f"\nSUCCESS: Detected 'bg-yellow-100' class in {url}!")
                        success = True
                        break

                    # Check if we are done (Judge Panel completed)
                    if "Judge Panel completed" in html and "bg-green-100" in html:
                        pass

            except Exception as e:
                print(f"Error polling {url}: {e}")

            time.sleep(0.5)
            sys.stdout.write(".")
            sys.stdout.flush()

        if not success:
            print(f"\nFAILURE: Timed out without detecting yellow state in {url}.")
            return False

    return True

if __name__ == "__main__":
    print("Creating submission...")
    sub_id = create_submission()
    print(f"Submission created with ID: {sub_id}")

    success = check_for_yellow_state(sub_id)
    if success:
        sys.exit(0)
    else:
        sys.exit(1)
