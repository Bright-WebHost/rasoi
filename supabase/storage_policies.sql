-- Storage Policies for menu_images bucket

-- Allow public read access to all images
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
TO public
USING ( bucket_id = 'menu_images' );

-- Allow authenticated staff members to upload images
CREATE POLICY "Staff Upload Access"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'menu_images' );

-- Allow authenticated staff members to update images
CREATE POLICY "Staff Update Access"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'menu_images' );

-- Allow authenticated staff members to delete images
CREATE POLICY "Staff Delete Access"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'menu_images' );
