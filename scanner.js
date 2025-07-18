document.addEventListener("DOMContentLoaded", ()=>{
    let clickedPoints = [];
    let manualBubbles = [];
    let originalImg = null;
    let preDetectionImg = null;
    const consoleLogEl = document.getElementById("consoleLog");

    function logToConsole(msg) {
        consoleLogEl.innerHTML += msg + "<br>";
        consoleLogEl.scrollTop = consoleLogEl.scrollHeight;
    }

    function loadImageToCanvas(imageSrc, clear=true) {
        const canvas = document.getElementById('outputCanvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        originalImg = imageSrc;

        img.onload = function () {
            const maxWidth = window.innerWidth;  // Use the window's width or set a specific max width
            // const maxHeight = window.innerHeight;  // Optional: set a max height for your canvas

            // Calculate scale factor to fit the image within the canvas dimensions
            let scaleFactor = 1;
            if (img.width > maxWidth) {
                scaleFactor = Math.min(maxWidth / img.width);
            }

            // Set canvas dimensions based on scaled image size
            canvas.width = img.width * scaleFactor;
            canvas.height = img.height * scaleFactor;

            // Draw the image to fit within the canvas dimensions
            ctx.drawImage(img, 0, 0, img.width * scaleFactor, img.height * scaleFactor);

            console.log(`Image loaded with scale factor: ${scaleFactor}`);
        };

        img.src = imageSrc;
        if (clear)
            reAlign(false);

    }

// Handles file input event and loads image to canvas
    document.getElementById('fileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();

        reader.onload = function (event) {
            const img = new Image();
            img.onload = function () {
                const canvas = document.getElementById('outputCanvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                logToConsole("Image loaded.");
                srcImage = img;
            };
            img.src = event.target.result;
            loadImageToCanvas(img.src);
        };

        if (file) {
            reader.readAsDataURL(file);
        }
    });

// Handles clicks on the canvas and records points for image alignment
    document.getElementById('outputCanvas').addEventListener('click', (event) => {
        const canvas = document.getElementById('outputCanvas');
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        if (clickedPoints.length < 4) {
            clickedPoints.push({x, y});
            logToConsole(`Point ${clickedPoints.length} selected at (${x}, ${y})`);
        } else {
            addBubble({x, y});
            return
        }

        if (clickedPoints.length === 4) {
            logToConsole("All four reference points selected. Previewing bubble positions...");
            // bubblePoints = ratio_method(clickedPoints);
            cv.imshow(canvas, applyPerspectiveTransform(cv.imread(canvas), (clickedPoints)));
        }
    });


    function addBubble({x, y}) {
        manualBubbles.push({ x: x-12, y: y-12, intensity: 50 });
        detectBubblesWithContours(cv.imread("outputCanvas"));
    }


// Empties clicked points and resets image to original file
    document.getElementById('reAlignButton').addEventListener('click', reAlign);

    function reAlign(load=true) {
        clickedPoints = [];
        manualBubbles = [];
        preDetectionImg = null;
        if (load)
            loadImageToCanvas(originalImg, false);
        logToConsole("Please select all four corner bubbles for alignment.");
    }


    function applyPerspectiveTransform(image, corners) {
        // Define target points for the perspective transformation
        const targetWidth = 800; // width of the "flattened" image
        const targetHeight = 1000; // height of the "flattened" image
        const targetCorners = [
            {x: 272, y: 98},               // Top-left
            {x: 776, y: 98},  // Top-right
            {x: 272, y: 922}, // Bottom-left
            {x: 776, y: 922} // Bottom-right
        ];

        // Convert points to OpenCV-compatible format
        const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
            corners[0].x, corners[0].y,
            corners[1].x, corners[1].y,
            corners[2].x, corners[2].y,
            corners[3].x, corners[3].y
        ]);
        const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
            targetCorners[0].x, targetCorners[0].y,
            targetCorners[1].x, targetCorners[1].y,
            targetCorners[2].x, targetCorners[2].y,
            targetCorners[3].x, targetCorners[3].y
        ]);

        // Compute perspective transformation matrix
        const transformationMatrix = cv.getPerspectiveTransform(srcPoints, dstPoints);
        const transformedImage = new cv.Mat();

        // Apply the perspective transform
        cv.warpPerspective(image, transformedImage, transformationMatrix, new cv.Size(targetWidth, targetHeight));

        // Cleanup
        srcPoints.delete();
        dstPoints.delete();
        transformationMatrix.delete();

        clickedPoints = targetCorners;

        return transformedImage;
    }


    document.getElementById('detectButton').addEventListener('click', () => {
        if (clickedPoints.length < 4) {
            alert("Please click on all four reference points before detecting.");
            return;
        }

        const canvas = document.getElementById('outputCanvas');
        const src = cv.imread(canvas);

        const result = detectBubblesWithContours(src);

        logToConsole(`Best detection: ${result.bubblesDetected.length} questions detected. Issues: ${result.misreads}`);
        // result.bubblesDetected.forEach(bubble=>logToConsole(`Q${bubble.question}: ${bubble.answers}`));

    });


    function drawBubble(image, {x, y, width, height}) {
        const color = new cv.Scalar(255, 255, 0);
        cv.circle(image, new cv.Point(x + width / 2, y + height / 2), 10, color, 2);
        return image;
    }


    function detectBubblesWithContours(transformedImage, threshold = 160) {
        if (preDetectionImg) {
            transformedImage = preDetectionImg;
            console.log("Pre-exists");
        } else {
            preDetectionImg = transformedImage;
            console.log("Doesn't Pre-exist");
        }

        let bubblesDetected = [];
        let misreads = 0;

        // Convert the image to grayscale
        const grayImage = new cv.Mat();
        cv.cvtColor(transformedImage, grayImage, cv.COLOR_RGBA2GRAY);

        // Apply a threshold to get a binary image
        const binaryImage = new cv.Mat();
        cv.threshold(grayImage, binaryImage, threshold, 255, cv.THRESH_BINARY_INV);

        // Detect contours
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(binaryImage, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        // Loop through contours and identify bubbles based on size and circularity
        for (let i = 0; i < contours.size(); i++) {
            const cnt = contours.get(i);
            const contourArea = cv.contourArea(cnt);

            // Filter based on contour area and circularity
            if (contourArea > 200 && contourArea < 400) { // Adjust these values based on bubble size
                const rect = cv.boundingRect(cnt);
                const aspectRatio = rect.width / rect.height;

                // Only process bubbles in the area between the corner bubbles
                if (250 > rect.x || rect.x > 790 || 80 > rect.y || rect.y > 940) {
                    console.log(rect);
                    continue
                }

                if (aspectRatio > 0.7 && aspectRatio < 1.3) { // Ensuring near-circular contours
                    // Get the center of the contour (bubble)
                    const centerX = rect.x + rect.width / 2;
                    const centerY = rect.y + rect.height / 2;

                    // Analyze the intensity within the bubble to check if it’s filled
                    const bubbleROI = transformedImage.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
                    const intensity = cv.mean(bubbleROI)[0];
                    bubbleROI.delete();

                    const isFilled = intensity < threshold;

                    // Record detection results
                    bubblesDetected.push(rect);
                }
            }
        }

        // Cleanup
        grayImage.delete();
        binaryImage.delete();
        contours.delete();
        hierarchy.delete();


        bubblesDetected = bubblesDetected.concat(manualBubbles);


        // Separate bubbles into column 1 and 2
        let col_1 = [];
        let col_2 = [];

        bubblesDetected.forEach(bubble => {
            if (bubble.width === undefined) {
                bubble.width = 25;
                bubble.height = 25;
            }

            // Analyze the intensity within the bubble to check if it’s filled
            const bubbleROI = transformedImage.roi(new cv.Rect(bubble.x, bubble.y, bubble.width, bubble.height));
            if (bubble.intensity === undefined)
                bubble.intensity = cv.mean(bubbleROI)[0];
            bubbleROI.delete();
            drawBubble(transformedImage, bubble);

            if (250 < bubble.x && bubble.x < 400) {
                col_1.push(bubble)
            } else if (650 < bubble.x && bubble.x < 790) {
                col_2.push(bubble)
            } else {
                console.log(bubble)
            }
        });

        cv.imshow("outputCanvas", transformedImage);

        // Sort both columns by their y-coordinates so that it's more or less sorted by question number
        col_1 = col_1.sort((a, b) => a.y - b.y);
        col_2 = col_2.sort((a, b) => a.y - b.y);

        // Group bubbles of the same answers together
        let bubbles_grouped = [];

        function groupBubbles(bubble) {
            if (bubbles_grouped.length) {
                let i = bubbles_grouped.length - 1;
                let last_q = bubbles_grouped[i];

                if (Math.abs(last_q.y - bubble.y) < 20) {
                    bubbles_grouped[i].bubbles.push(bubble);
                    return
                }
            }
            bubbles_grouped.push({y: bubble.y, bubbles: [bubble,]});
        }

        col_1.forEach(groupBubbles);
        col_2.forEach(groupBubbles);

        // Sort bubbles by intensity
        bubbles_grouped.forEach((grp, i) => {
            let bubbles = grp.bubbles.sort((b1, b2) => {
                return b1.intensity - b2.intensity
            });
            bubbles_grouped[i].bubbles = bubbles;

            bubbles[0].x += 12;

            let col_start = (bubbles[0].x > 650) ? 660 : 260;
            bubbles_grouped[i].answer = Math.ceil((bubbles[0].x - col_start) / 25)
        })

        // Find selected answer for each
        console.log(bubbles_grouped);

        return {bubblesDetected, misreads, bubbles_grouped};
    }
});