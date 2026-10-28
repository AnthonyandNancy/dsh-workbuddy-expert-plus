# vendor-input

This directory is a **build-time input**, never a runtime dependency.

- Source snapshot: `infometa/workbuddyskills@7ea565af29f6bede2acc0d7b55daa300db5de3f8`.
- Build scripts read `experts/expert_center.json`, `experts/<plugin>/agents/*.md`,
  avatars, skills, and license files from here.
- Generated output is committed under `../resources/experts`; the `.tgz`
  contains that output only. Deleting this directory must not affect installed
  plugins.
