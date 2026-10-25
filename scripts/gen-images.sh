#!/bin/bash
# FiruWalk brand asset generation — runs in background while we build.
# Style: photorealistic portraits/pets, flat warm illustration for hero.
cd /home/z/my-project
mkdir -p public/images/walkers public/images/owners public/images/dogs public/images/walks

gen() { # $1 prompt  $2 output  $3 size
  if [ -s "$2" ]; then echo "skip $2"; return; fi
  for i in 1 2 3; do
    z-ai image -p "$1" -o "$2" -s "$3" >/dev/null 2>&1 && [ -s "$2" ] && echo "ok $2" && return
    sleep 2
  done
  echo "FAIL $2"
}

# ---- Lane 1: hero + walk photos ----
(
gen "Flat vector illustration, warm friendly style: a young woman walking a happy golden retriever on a leash through a sunny tropical park in Santa Cruz Bolivia, palm trees, green grass, soft rounded shapes, palette of vibrant green and warm amber orange, subtle grain texture, no text" "public/images/hero.png" "1440x720"
gen "Photorealistic photo of a golden retriever on a leash mid-walk on a tree-lined suburban street, morning golden light, high quality" "public/images/walks/walk-1.png" "1024x1024"
gen "Photorealistic photo of a beagle sniffing grass in a park with palm trees, daytime, high quality" "public/images/walks/walk-2.png" "1024x1024"
gen "Photorealistic photo of a french bulldog drinking water from a portable dog bowl, park bench background, warm afternoon light, high quality" "public/images/walks/walk-3.png" "1024x1024"
) &

# ---- Lane 2: walker avatars ----
(
gen "Head and shoulders portrait photo of a smiling 22 year old Latino man short dark hair, red t-shirt, outdoor park background, soft warm sunlight, photorealistic, high quality" "public/images/walkers/walker-1.png" "1024x1024"
gen "Head and shoulders portrait photo of a friendly 24 year old Latina woman with brown hair in a ponytail, green athletic shirt, sunny outdoor background, photorealistic, high quality" "public/images/walkers/walker-2.png" "1024x1024"
gen "Head and shoulders portrait photo of a cheerful 26 year old Latino man with a beard, denim shirt, outdoor urban background, warm evening light, photorealistic, high quality" "public/images/walkers/walker-3.png" "1024x1024"
gen "Head and shoulders portrait photo of a warm smiling 23 year old Latina woman with curly dark hair, yellow blouse, park background, soft daylight, photorealistic, high quality" "public/images/walkers/walker-4.png" "1024x1024"
) &

# ---- Lane 3: more walkers ----
(
gen "Head and shoulders portrait photo of a friendly 28 year old Latino man, cap and gray hoodie, outdoor street background, daylight, photorealistic, high quality" "public/images/walkers/walker-5.png" "1024x1024"
gen "Head and shoulders portrait photo of a young 21 year old Latina woman with straight black hair, white t-shirt, green plants background, bright daylight, photorealistic, high quality" "public/images/walkers/walker-6.png" "1024x1024"
gen "Head and shoulders portrait photo of a calm 30 year old Latino man, light blue shirt, tree-lined avenue background, golden hour, photorealistic, high quality" "public/images/walkers/walker-7.png" "1024x1024"
gen "Head and shoulders portrait photo of an energetic 25 year old Latina woman with shoulder-length hair, coral shirt, plaza background, sunny day, photorealistic, high quality" "public/images/walkers/walker-8.png" "1024x1024"
) &

wait

# ---- Lane batch 4: pending walkers ----
(
gen "Head and shoulders portrait photo of a 23 year old Latino man with short curly hair, olive green jacket, simple wall background, neutral daylight, photorealistic, high quality" "public/images/walkers/walker-9.png" "1024x1024"
) &
(
gen "Head and shoulders portrait photo of a 27 year old Latina woman with hair in a bun, lavender shirt, soft neutral background, daylight, photorealistic, high quality" "public/images/walkers/walker-10.png" "1024x1024"
) &

# ---- Lane batch 5: owners ----
(
gen "Head and shoulders portrait photo of a professional 32 year old Latina woman, long dark hair, light blazer, office-ish bright background, friendly smile, photorealistic, high quality" "public/images/owners/owner-1.png" "1024x1024"
gen "Head and shoulders portrait photo of a 40 year old Latino man, glasses, checked shirt, warm home background, friendly, photorealistic, high quality" "public/images/owners/owner-2.png" "1024x1024"
) &
(
gen "Head and shoulders portrait photo of a 29 year old Latina woman with wavy hair, terracotta sweater, garden background, warm smile, photorealistic, high quality" "public/images/owners/owner-3.png" "1024x1024"
gen "Head and shoulders portrait photo of a 35 year old Latino man, athletic build, black t-shirt, gym-park background, confident smile, photorealistic, high quality" "public/images/owners/owner-4.png" "1024x1024"
) &
wait

# ---- Lane batch 6: dogs ----
(
gen "Photorealistic photo of a golden retriever sitting looking at camera, garden background, sunny day, high quality" "public/images/dogs/dog-1.png" "1024x1024"
gen "Photorealistic photo of a beagle puppy sitting on grass, tongue out, high quality" "public/images/dogs/dog-2.png" "1024x1024"
gen "Photorealistic photo of a brown and white pitbull mix dog with a red harness sitting calmly, park background, high quality" "public/images/dogs/dog-3.png" "1024x1024"
) &
(
gen "Photorealistic photo of a white toy poodle with a tidy haircut sitting on a patio, high quality" "public/images/dogs/dog-4.png" "1024x1024"
gen "Photorealistic photo of a fawn french bulldog with a blue bandana sitting on a rug indoors, high quality" "public/images/dogs/dog-5.png" "1024x1024"
) &
(
gen "Photorealistic photo of a brown dachshund standing on a sidewalk wagging tail, high quality" "public/images/dogs/dog-6.png" "1024x1024"
gen "Photorealistic photo of a black and white border collie running in a park, motion, high quality" "public/images/dogs/dog-7.png" "1024x1024"
) &
wait
echo "ALL_DONE"
