# Releasing Pixelhof

Pushing a `v*` tag starts `.github/workflows/publish.yml`. The workflow checks
that the tag matches both package versions, then installs dependencies,
typechecks, tests, builds, and publishes to npm with provenance.

## Publishing access

Configure a trusted publisher in the npm settings for `pixelhof`:

- Provider: GitHub Actions
- Organization or user: `robinsadeghpour`
- Repository: `pixelhof-cli`
- Workflow filename: `publish.yml`
- Environment: leave empty; the workflow does not use a GitHub environment
- Allow direct publishing with `npm publish`

The workflow installs npm 11 and requests an OIDC token. See
[npm's trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).
It also supports an `NPM_TOKEN` repository secret whose token can publish
`pixelhof` if trusted publishing is unavailable.

## Prepare the release

1. Check `npm view pixelhof versions --json` and choose an unpublished version.
2. Set the same version in `package.json` and `.claude-plugin/plugin.json`.
   A version-only change does not require a `pnpm-lock.yaml` update.
3. Add the release notes to `CHANGELOG.md`.
4. Run the checks and inspect the package contents:

   ```sh
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm test
   pnpm build
   npm pack --dry-run
   ```

5. Merge the release changes into `main` and wait for CI to pass. Tag the
   release commit from a clean checkout that matches `origin/main`.

## Tag and verify

Set the version being released, create an annotated tag, and push it:

```sh
release_version=0.1.1
git tag -a "v${release_version}" -m "Release v${release_version}"
git push origin "v${release_version}"
```

Watch the Publish workflow in GitHub Actions. That workflow publishes the
package; a separate manual `npm publish` would race it. If publishing fails,
check whether the version reached npm before retrying the workflow. Keep a
pushed release tag on its original commit.

After the workflow succeeds, verify the registry version and distribution tag:

```sh
npm view "pixelhof@${release_version}" version dist.integrity
npm view pixelhof dist-tags --json
```

Create a GitHub release for the existing `v${release_version}` tag, using the
matching changelog entry as its release notes. Confirm that the release links
to the intended commit and that npm's `latest` tag points to the released
version.
