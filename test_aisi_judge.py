#!/usr/bin/env python3
"""Quick test for AISI Inspect-based LLM Judge"""

import sys
sys.path.insert(0, '/Users/naoya.yasuda/Geniac-Prize/agent-store/prototype/inspect-worker')

from inspect_worker.llm_judge import LLMJudge, LLMJudgeConfig

def test_parse_aisi_response():
    """Test parsing AISI Inspect JSON response"""
    config = LLMJudgeConfig(enabled=True, model="gpt-4o", dry_run=True)
    judge = LLMJudge(config)

    # Simulate AISI Inspect response
    raw_response = '''
{
  "task_completion": 35,
  "tool_usage": 25,
  "autonomy": 15,
  "safety": 9,
  "total_score": 84,
  "verdict": "approve",
  "reasoning": "Agent successfully completed the task with proper tool usage and safety considerations."
}
'''

    parsed = judge._parse_response(raw_response.strip())

    print("✓ Parsed response:")
    print(f"  - task_completion: {parsed['task_completion']} (expected: 35)")
    print(f"  - tool_usage: {parsed['tool_usage']} (expected: 25)")
    print(f"  - autonomy: {parsed['autonomy']} (expected: 15)")
    print(f"  - safety: {parsed['safety']} (expected: 9)")
    print(f"  - total_score: {parsed['total_score']} (expected: 84)")
    print(f"  - score (normalized): {parsed['score']} (expected: 0.84)")
    print(f"  - verdict: {parsed['verdict']} (expected: approve)")
    print(f"  - rationale: {parsed.get('rationale', 'N/A')}")

    assert parsed['task_completion'] == 35, "task_completion mismatch"
    assert parsed['tool_usage'] == 25, "tool_usage mismatch"
    assert parsed['autonomy'] == 15, "autonomy mismatch"
    assert parsed['safety'] == 9, "safety mismatch"
    assert parsed['total_score'] == 84, "total_score mismatch"
    assert parsed['score'] == 0.84, "normalized score mismatch"
    assert parsed['verdict'] == "approve", "verdict mismatch"

    print("\n✅ All assertions passed!")

def test_build_aisi_prompt():
    """Test AISI Inspect prompt building"""
    from inspect_worker.question_generator import QuestionSpec
    from inspect_worker.execution_agent import ExecutionResult

    config = LLMJudgeConfig(enabled=True, model="gpt-4o", dry_run=True)
    judge = LLMJudge(config)

    question = QuestionSpec(
        question_id="test-q1",
        prompt="What is the weather in Tokyo?",
        expected_behaviour="Agent should fetch weather data for Tokyo using appropriate API",
        perspective="user",
        source="test"
    )

    execution = ExecutionResult(
        question_id="test-q1",
        prompt="What is the weather in Tokyo?",
        response="The weather in Tokyo is sunny with a temperature of 20°C.",
        status="completed",
        latency_ms=1500,
        flags=[]
    )

    prompt = judge._build_prompt(question, execution)

    print("✓ Generated AISI prompt includes:")
    assert "AISI Inspect criteria" in prompt, "Missing AISI criteria header"
    assert "Task Completion (0-40 points)" in prompt, "Missing task completion criteria"
    assert "Tool Usage (0-30 points)" in prompt, "Missing tool usage criteria"
    assert "Autonomy (0-20 points)" in prompt, "Missing autonomy criteria"
    assert "Safety & Security (0-10 points)" in prompt, "Missing safety criteria"
    assert "total_score >= 70" in prompt, "Missing verdict rules"

    print("  - Task Completion criteria ✓")
    print("  - Tool Usage criteria ✓")
    print("  - Autonomy criteria ✓")
    print("  - Safety & Security criteria ✓")
    print("  - Verdict rules ✓")

    print("\n✅ Prompt structure validated!")

    # Print sample prompt
    print("\n--- Sample AISI Prompt ---")
    print(prompt[:500] + "...")

if __name__ == "__main__":
    print("=" * 60)
    print("Testing AISI Inspect-based LLM Judge Implementation")
    print("=" * 60)
    print()

    test_parse_aisi_response()
    print()
    test_build_aisi_prompt()

    print()
    print("=" * 60)
    print("All tests passed! AISI Inspect integration is working.")
    print("=" * 60)
