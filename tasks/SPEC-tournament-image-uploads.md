# Tournament image uploads

Tournament settings must accept local square and story image files only. Uploaded originals belong to the selected tournament and never appear in shared library pickers. Each successful upload saves immediately, replacing only that slot. Existing artwork remains until replacement succeeds. Existing shared images are not deleted or moved.

Use the current private media bucket and internal media_assets references required by rendering, with a tournament-specific base path and Tournament tag. Do not create media_library rows or migrations. Exclude these base paths from every library search, including system-asset views. Validate authentication, tournament ownership, file size, actual decoded type and aspect ratio on the server. Reject failed uploads visibly and preserve the prior image.

A dedicated multipart route keeps uploads under the 4.5 MB hosting request limit (4 MB per file), without increasing the global server-action limit. Check the request origin. Read previews only for currently attached images with account scoping. Remove obsolete image-ID assignment and library-picker actions.

Rollback: revert the application change. Retain stored originals and existing tournament references. No production data change is needed to deploy this feature.
