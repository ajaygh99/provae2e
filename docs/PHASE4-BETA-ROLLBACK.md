# Phase 4 Beta Approval, Rollback, and Recovery

This runbook protects the `0.3.5-beta.1` candidate before and after a controlled
beta publication. It never requires a force-push or branch deletion.

## Approval boundary

Preparation, packing, checksumming, tagging a checkpoint, and creating a Git
bundle do not publish the package. Run `npm publish --tag beta` only after the
owner explicitly approves publication and every checkbox in
`releases/v0.3.5-beta.1-approval.md` has evidence for the exact release commit.

## Merge and validation order

Merge the Phase 4 stack bottom-up:

1. Native mobile/Appium proof into `release/v0.3.5-phase4`.
2. Plugin/integration hardening into `release/v0.3.5-phase4`.
3. Documentation/release preparation into `release/v0.3.5-phase4`.

After each base change, update the next PR normally, rerun its checks, and merge
only when green. Never rewrite the branch with a force-push.

On the final release commit, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-beta.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-phase4-package.ps1
```

## Recoverable checkpoint

Record the exact commit, create an annotated tag, and create a complete bundle:

```powershell
$commit = git rev-parse release/v0.3.5-phase4
git tag -a phase4-beta-checkpoint-45-of-45 $commit -m "Phase 4 beta checkpoint"
git push origin refs/tags/phase4-beta-checkpoint-45-of-45
git bundle create phase4-beta-checkpoint.bundle --all
git bundle verify phase4-beta-checkpoint.bundle
Get-FileHash phase4-beta-checkpoint.bundle -Algorithm SHA256
```

Store the bundle, checksum, package tarball, package-integrity manifest, release
commit, and recovery instructions outside the repository working tree.

## Repository recovery

Clone from the bundle and reconnect the normal remote:

```powershell
git clone .\phase4-beta-checkpoint.bundle prova-phase4-recovery
Set-Location .\prova-phase4-recovery
git remote rename origin checkpoint
git remote add origin https://github.com/ajaygh99/provae2e.git
git switch -c recovery/phase4-beta phase4-beta-checkpoint-45-of-45
git push -u origin recovery/phase4-beta
```

This creates a new recovery branch and preserves all existing history.

## Package rollback

Before publication, stop: there is no registry state to undo. After a beta
publication, prefer publishing a fixed prerelease and moving the `beta`
dist-tag. If the published build is unsafe, remove the `beta` dist-tag or
deprecate that exact version according to the registry policy. Never rewrite
Git history to hide a published package.

Capture the incident decision, affected version, replacement version, registry
commands, timestamps, and resulting dist-tags in the release evidence.
