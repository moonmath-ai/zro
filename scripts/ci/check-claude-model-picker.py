#!/usr/bin/env python3
"""Check that all Zro models are visible in the Claude Code /model picker."""

import datetime
import json
import os
import re
import subprocess
import sys
import tempfile

import pexpect


def main() -> int:
    if len(sys.argv) < 4:
        print(
            "usage: check-claude-model-picker.py <selected-model> <selected-label> <expected-label>...",
            file=sys.stderr,
        )
        return 2

    model = sys.argv[1]
    selected_label = sys.argv[2]
    expected_labels = sys.argv[3:]
    zro_bin = os.environ.get("ZRO_BIN", "zro")
    transcript = ""

    # The packed zro under test may lag the npm registry's `latest`. zro's
    # upgrade check would otherwise fetch the registry, see a newer version,
    # and — because this run is driven through a PTY — render its interactive
    # "Upgrade now?" menu, blocking before Claude Code ever launches. zro reads
    # its upgrade cache from $HOME/.config/zro/upgrade-check.json; we own a
    # throwaway HOME below, so seed it to look fresh and up to date.
    current_version = subprocess.run(
        [zro_bin, "version"], capture_output=True, text=True, check=False
    ).stdout.strip()

    with tempfile.TemporaryDirectory(prefix="zro-claude-models-") as home:
        project = os.getcwd()
        state = {
            "hasCompletedOnboarding": True,
            "lastOnboardingVersion": "999.0.0",
            "installMethod": "npm",
            "numStartups": 1,
            "projects": {
                project: {
                    "hasTrustDialogAccepted": True,
                    "projectOnboardingSeenCount": 1,
                }
            },
        }
        with open(os.path.join(home, ".claude.json"), "w", encoding="utf-8") as state_file:
            json.dump(state, state_file)

        if current_version:
            upgrade_cache_dir = os.path.join(home, ".config", "zro")
            os.makedirs(upgrade_cache_dir, exist_ok=True)
            with open(
                os.path.join(upgrade_cache_dir, "upgrade-check.json"),
                "w",
                encoding="utf-8",
            ) as cache_file:
                json.dump(
                    {
                        "lastCheckedAt": datetime.datetime.now(
                            datetime.timezone.utc
                        ).isoformat(),
                        "latestVersion": current_version,
                        "skippedVersion": None,
                    },
                    cache_file,
                )

        env = dict(os.environ)
        env.update(
            {
                "HOME": home,
                "TERM": "xterm-256color",
            }
        )

        child = pexpect.spawn(
            zro_bin,
            [
                "launch",
                "claude",
                "--model",
                model,
                "--",
                "--ax-screen-reader",
                "--safe-mode",
            ],
            cwd=project,
            env=env,
            encoding="utf-8",
            timeout=25,
            dimensions=(42, 160),
        )

        try:
            # Claude asks the terminal for its version and device attributes
            # before accepting input. pexpect is a PTY rather than a terminal
            # emulator, so provide the standard xterm replies explicitly.
            child.expect("\x1b\\[c")
            transcript += child.before + child.after
            child.send("\x1bP>|XTerm(370)\x1b\\\x1b[?1;2c")
            child.send("/model\r")

            # Claude's model picker prompt has drifted across versions ("Enter
            # selection" → "Select with numbers [1-5]. Then Enter to submit...").
            # Match a stable fragment shared by both so the check is version-tolerant.
            child.expect("Enter selection|Enter to submit|Select with numbers")
            transcript += child.before + child.after

            plain = strip_terminal_sequences(transcript)
            picker = plain[plain.rfind("Select model") :]
            for expected_label in expected_labels:
                if expected_label not in picker:
                    raise AssertionError(f"missing model label {expected_label!r}")
            if f"(selected) {selected_label}" not in picker:
                raise AssertionError(f"{selected_label!r} is not selected")
        except (AssertionError, pexpect.EOF, pexpect.TIMEOUT) as error:
            transcript += child.before or ""
            plain = strip_terminal_sequences(transcript)[-4000:]
            print(f"Claude Code model discovery failed for {model}: {error}", file=sys.stderr)
            print(plain, file=sys.stderr)
            return 1
        finally:
            if child.isalive():
                child.sendcontrol("c")
                child.sendcontrol("c")
                child.close(force=True)

    print(f"Claude Code /model lists all Zro models with {selected_label} selected")
    return 0


def strip_terminal_sequences(value: str) -> str:
    value = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", value)
    return re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)", "", value)


if __name__ == "__main__":
    raise SystemExit(main())
