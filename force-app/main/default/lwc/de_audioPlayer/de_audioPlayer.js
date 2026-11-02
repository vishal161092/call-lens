import { api, LightningElement, wire } from "lwc";
import getAudioURL from "@salesforce/apex/de_AudioFileUtilities.getAudioURL";
import getAudioFileContent from "@salesforce/apex/de_AudioFileUtilities.getAudioFileContent";
// import { getFieldValue, getRecord } from "lightning/uiRecordApi";
// import FIELD_DESCRIPTION from "@salesforce/schema/ContentDocument.Description";
// import FIELD_FILEEXTENSION from "@salesforce/schema/ContentDocument.FileExtension";
import einsteinMainGif from "@salesforce/resourceUrl/Einstein_Main";
import einsteinLoadin from "@salesforce/resourceUrl/Einstein_Loading";
// import FIELD_FILETYPE from "@salesforce/schema/ContentDocument.FileType";
// import FIELD_TITLE from "@salesforce/schema/ContentDocument.Title";

// const CONTENT_DOCUMENT_FIELDS = [
//     FIELD_DESCRIPTION,
//     FIELD_FILEEXTENSION,
//     FIELD_FILETYPE,
//     FIELD_TITLE
// ];

// const AUDIO_FIELDS = [
//     AUDIO_URL
// ];

export default class De_audioPlayer extends LightningElement {
    @api audioContentDocumentId;
    @api recordId;

    einsteinMainGif = einsteinMainGif;
    einsteinLoadin = einsteinLoadin;

    keywords = [];
    loadingTopics = false;

    baseUrl = "";
    volume = 100;
    audioLoaded = false;
    summaryTrans = false;
    einsteinLoading = false;
    audioElement;
    audioBlobUrl; // Store blob URL for cleanup
    summary;
    summary_External;
    isAudioInitializing = false;

    load1_1 = true;
    load1_2 = false;
    load2_1 = true;
    load2_2 = false;
    load3_1 = true;
    load3_2 = false;
    load4_1 = true;
    load5_2 = false;

    first_timeSpan = 1000;
    timeSpan = 2000;

    // @wire(getRecord, {
    //     recordId: this.recordId,
    //     fields: AUDIO_FIELDS
    // })
    // contentRecord;


connectedCallback() {
  console.log("Testing>> " + this.recordId);
  
  // Try to get file content directly from Apex (avoids CORS)
  getAudioFileContent({
    recId: this.recordId
  })
  .then((result) => {
    console.log("Audio file content received");
    const fileData = JSON.parse(result);
    this.loadAudioFromBase64(fileData.content, fileData.fileType);
  })
  .catch((error) => {
    console.log("Error getting audio file content, falling back to URL method: " + error);
    // Fallback to URL method if file content method fails
    getAudioURL({
      recId: this.recordId
    })
    .then((result) => {
      console.log("Audio URL >> " + result);
      this.audioSrc = result;
      this.initializeAudioElement();
    })
    .catch((urlError) => {
      console.log("@@ Error getting audio URL: " + urlError);
    });
  });
}

    loadAudioFromBase64(base64Content, fileType) {
        // Wait for DOM to be ready
        setTimeout(() => {
            this.audioElement = this.template.querySelector("audio");
            if (!this.audioElement) {
                console.error("Audio element not found");
                return;
            }

            try {
                // Convert base64 to binary string
                const binaryString = atob(base64Content);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                // Determine MIME type based on file extension
                let mimeType = 'audio/mpeg'; // default
                if (fileType) {
                    const typeMap = {
                        'mp3': 'audio/mpeg',
                        'wav': 'audio/wav',
                        'ogg': 'audio/ogg',
                        'm4a': 'audio/mp4',
                        'aac': 'audio/aac',
                        'flac': 'audio/flac'
                    };
                    mimeType = typeMap[fileType.toLowerCase()] || `audio/${fileType.toLowerCase()}`;
                }

                // Create blob from bytes
                const blob = new Blob([bytes], { type: mimeType });
                console.log("Audio blob created from base64, type:", mimeType, "size:", blob.size);

                // Clean up previous blob URL if exists
                if (this.audioBlobUrl) {
                    URL.revokeObjectURL(this.audioBlobUrl);
                }

                // Create object URL from blob
                const objectUrl = URL.createObjectURL(blob);
                this.audioBlobUrl = objectUrl; // Store for cleanup
                console.log("Object URL created:", objectUrl);

                // Set blob URL as audio source
                this.audioElement.src = objectUrl;
                this.setupAudioEventListeners();
                this.audioElement.load();
            } catch (error) {
                console.error("Error loading audio from base64:", error);
            }
        }, 100);
    }

    setupAudioEventListeners() {
        if (!this.audioElement) return;

        // Add metadata listeners (only add once)
        if (!this.listenersSetup) {
            this.audioElement.addEventListener("loadedmetadata", () => {
                const duration = this.audioElement.duration;
                console.log("Audio Duration >> ", duration);
                this.audioLoaded = true;
            });

            this.audioElement.addEventListener("error", (e) => {
                console.error("Audio loading error:", e);
                console.error("Audio element error details:", this.audioElement.error);
                if (this.audioElement.error) {
                    console.error("Error code:", this.audioElement.error.code);
                    console.error("Error message:", this.audioElement.error.message);
                }
            });

            this.audioElement.addEventListener("canplay", () => {
                console.log("Audio can play");
            });

            this.audioElement.addEventListener("loadeddata", () => {
                console.log("Audio data loaded");
            });

            this.listenersSetup = true;
        }
    }

    async initializeAudioElement() {
        if (this.isAudioInitializing) {
            return;
        }
        this.isAudioInitializing = true;
        // Wait for DOM to be ready, then initialize audio element
        setTimeout(async () => {
            this.audioElement = this.template.querySelector("audio");
            if (this.audioElement && this.audioSrc) {
                try {
                    // Fetch audio file as blob with credentials to handle Salesforce authentication
                    console.log("Fetching audio from:", this.audioSrc);
                    const response = await fetch(this.audioSrc, {
                        method: 'GET',
                        credentials: 'include', // Include Salesforce session cookies
                        headers: {
                            'Accept': 'audio/*'
                        }
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    // Convert response to blob
                    const blob = await response.blob();
                    console.log("Audio blob created, type:", blob.type, "size:", blob.size);

                    // Clean up previous blob URL if exists
                    if (this.audioBlobUrl) {
                        URL.revokeObjectURL(this.audioBlobUrl);
                    }

                    // Create object URL from blob
                    const objectUrl = URL.createObjectURL(blob);
                    this.audioBlobUrl = objectUrl; // Store for cleanup
                    console.log("Object URL created:", objectUrl);

                    // Set blob URL as audio source
                    this.audioElement.src = objectUrl;
                    this.setupAudioEventListeners();
                    this.audioElement.load();
                } catch (error) {
                    console.error("Error fetching audio file:", error);
                    // Fallback: try direct URL (might work if CORS allows)
                    this.audioElement.src = this.audioSrc;
                    this.audioElement.load();
                }
            }
            this.isAudioInitializing = false;
        }, 100);
    }

    renderedCallback() {
        // Ensure audio element is initialized after render
        if (!this.audioElement) {
            this.audioElement = this.template.querySelector("audio");
        }
        
        // If audioSrc is available but audio element src is not set, initialize it
        if (this.audioElement && this.audioSrc && !this.audioElement.src && !this.audioBlobUrl) {
            // Only initialize if we haven't already created a blob URL
            this.initializeAudioElement();
        }
    }

    disconnectedCallback() {
        // Clean up blob URL when component is destroyed
        if (this.audioBlobUrl) {
            URL.revokeObjectURL(this.audioBlobUrl);
            this.audioBlobUrl = null;
        }
    }


handlePillClick(event) {
        // Prevent the default behavior of the anchor tag
        event.preventDefault();
        
        // Ensure audio element is initialized
        if (!this.audioElement) {
            this.audioElement = this.template.querySelector("audio");
        }
        
        if (!this.audioElement) {
            console.error("Audio element not found");
            return;
        }
        
        // Get the clicked keyword from the data-keyword attribute on the span
        const clickedKeyword = event.currentTarget.dataset.keyword;

        // Find the corresponding object in the keywords array
        const keywordObj = this.keywords.find(item => item.keyword === clickedKeyword);

        // Get the timestamp associated with the clicked keyword
        if (keywordObj) {
            const timestamp = keywordObj.timestamps;
            console.log('Clicked Keyword:', clickedKeyword);
            console.log('Associated Timestamp:', timestamp);

            console.log("testin... " + this.currentTime);
            this.audioElement.currentTime = timestamp;
            console.log("testin... " + this.currentTime);

            this.lastPosition = this.currentTime;
        }

    }

    // file properties

    // get fileDescription() {
    //     return getFieldValue(this.contentRecord.data, FIELD_DESCRIPTION);
    // }

    // get fileExtension() {
    //     return getFieldValue(this.contentRecord.data, FIELD_FILEEXTENSION);
    // }

    // get fileType() {
    //     return getFieldValue(this.contentRecord.data, FIELD_FILETYPE);
    // }

    // get fileTitle() {
    //     return getFieldValue(this.contentRecord.data, FIELD_TITLE);
    // }


    // player
    isPlaying = false;
    currentTimePercentage = 0;
    lastPosition = 0;
    playbackSpeed = 1.0;
    volume = 100;

    get waveClass() {
        return this.isPlaying
            ? "wf-bars wf-bars-played wf-bars-playing"
            : "wf-bars wf-bars-played";
    }

    get waveformProgressStyle() {
        const pct = this.currentTimePercentage || 0;
        return `clip-path: inset(0 ${100 - pct}% 0 0);`;
    }

    get playheadStyle() {
        return `left: ${this.currentTimePercentage || 0}%;`;
    }

    get playbackSpeedLabel() {
        return this.playbackSpeed + "x";
    }

    get volumeLevel() {
        return this.volume;
    }

    get playPauseIcon() {
        if (this.isPlaying) {
            return "utility:pause";
        }
        return "utility:play";
    }

    get playPauseAltText() {
        if (this.isPlaying) {
            return "Pause";
        }
        return "Play";
    }

    get currentTime() {
        if (!this.audioElement || isNaN(this.audioElement.currentTime)) {
            return 0;
        }
        return this.audioElement.currentTime;
    }

    get totalTime() {
        if (!this.audioElement || isNaN(this.audioElement.duration)) {
            return 0;
        }
        return this.audioElement.duration;
    }

    get currentTimeFormatted() {
        if (!this.audioElement || isNaN(this.audioElement.currentTime)) {
            return "0:00";
        }
        let minutes = Math.floor(this.audioElement.currentTime / 60);
        let seconds = this.audioElement.currentTime - minutes * 60;
        return `${minutes}:${
            seconds < 10 ? "0" + seconds.toFixed(0) : seconds.toFixed(0)
        }`;
    }

    get totalTimeFormatted() {
        if (!this.audioElement || isNaN(this.audioElement.duration)) {
            return "0:00";
        }
        let minutes = Math.floor(this.audioElement.duration / 60);
        let seconds = this.audioElement.duration - minutes * 60;
        return `${minutes}:${
            seconds < 10 ? "0" + seconds.toFixed(0) : seconds.toFixed(0)
        }`;
    }

    handlePlayPause(e) {
        if (!this.audioElement) {
            this.audioElement = this.template.querySelector("audio");
        }
        
        if (!this.audioElement) {
            console.error("Audio element not found");
            return;
        }

        this.isPlaying = !this.isPlaying;

        if (this.isPlaying) {
            // Do NOT call load() here; it can interrupt play() and throw AbortError.
            // If source is missing, initialize and wait for user to click again.
            if (!this.audioElement.src) {
                if (this.audioSrc) {
                    this.initializeAudioElement();
                }
                this.isPlaying = false;
                return;
            }

            const startPlayback = () => {
                if (this.lastPosition !== 0 && !isNaN(this.audioElement.duration)) {
                    console.log("setting time to last position: " + this.lastPosition);
                    this.audioElement.currentTime = this.lastPosition;
                }
                return this.audioElement.play();
            };

            const playPromise = this.audioLoaded
                ? startPlayback()
                : new Promise((resolve, reject) => {
                    const onCanPlay = () => {
                        this.audioElement.removeEventListener('canplay', onCanPlay);
                        this.audioElement.removeEventListener('error', onError);
                        startPlayback().then(resolve).catch(reject);
                    };
                    const onError = (err) => {
                        this.audioElement.removeEventListener('canplay', onCanPlay);
                        this.audioElement.removeEventListener('error', onError);
                        reject(err);
                    };
                    this.audioElement.addEventListener('canplay', onCanPlay, { once: true });
                    this.audioElement.addEventListener('error', onError, { once: true });
                });
            
            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        console.log("Audio playing successfully");
                    })
                    .catch(error => {
                        console.error("Error playing audio:", error);
                        this.isPlaying = false;
                        // Common issues: autoplay policy, CORS, or invalid URL
                        if (error.name === 'NotAllowedError') {
                            console.error("Autoplay was prevented. User interaction required.");
                        } else if (error.name === 'NotSupportedError') {
                            console.error("Audio format not supported or URL invalid.");
                        }
                    });
            }
        } else {
            this.audioElement.pause();
        }
    }

    handleOnPlay(e) {
        console.log("playback began at " + this.currentTime);
    }

    testing(e) {
        console.log("testin... " + this.currentTime);
        this.audioElement.currentTime = 20;
        this.lastPosition = this.currentTime;
    }

    handleOnPause(e) {
        console.log("paused at " + this.currentTime);
        this.lastPosition = this.currentTime;
    }

    handleOnSeeked(e) {
        console.log("seeked! at " + this.currentTime);
        this.lastPosition = this.currentTime;
    }

    handleOnSeeking(e) {
        console.log("seeking... at " + this.currentTime);
    }

    handleSkipForward(e) {
        if (!this.audioElement) {
            this.audioElement = this.template.querySelector("audio");
        }
        if (this.audioElement && !isNaN(this.audioElement.currentTime)) {
            this.audioElement.currentTime += 15;
        }
    }

    handleSkipBack(e) {
        if (!this.audioElement) {
            this.audioElement = this.template.querySelector("audio");
        }
        if (this.audioElement && !isNaN(this.audioElement.currentTime)) {
            this.audioElement.currentTime = Math.max(0, this.audioElement.currentTime - 15);
        }
    }

    handleOnTimeUpdate(e) {
        if (!this.audioElement) {
            this.audioElement = this.template.querySelector("audio");
        }
        if (this.audioElement && !isNaN(this.audioElement.currentTime) && !isNaN(this.audioElement.duration) && this.audioElement.duration > 0) {
            this.currentTimePercentage =
                (this.audioElement.currentTime / this.audioElement.duration) * 100;
        }
    }

    handleSeek(e) {
        if (!this.audioElement) {
            this.audioElement = this.template.querySelector("audio");
        }
        if (!this.audioElement || isNaN(this.audioElement.duration) || this.audioElement.duration <= 0) {
            return;
        }
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this.audioElement.currentTime = pct * this.audioElement.duration;
        this.lastPosition = this.audioElement.currentTime;
    }

    handleSpeedChange(e) {
        const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
        const idx = speeds.indexOf(this.playbackSpeed);
        this.playbackSpeed = speeds[(idx + 1) % speeds.length];
        if (!this.audioElement) {
            this.audioElement = this.template.querySelector("audio");
        }
        if (this.audioElement) {
            this.audioElement.playbackRate = this.playbackSpeed;
        }
    }

    handleVolumeChange(e) {
        this.volume = parseInt(e.target.value, 10);
        if (!this.audioElement) {
            this.audioElement = this.template.querySelector("audio");
        }
        if (this.audioElement) {
            this.audioElement.volume = this.volume / 100;
        }
    }


    buttonHandler(e){
        console.log('RecId >> '+this.recordId);
        this.delayTime();
        this.einsteinLoading = true;
        // getSummary({
            
        //     })
        //     .then((result) => {
        //         console.log(">> " + result);
        //         this.einsteinLoading = false;
        //         this.summaryTrans = true;
        //         this.summary = result;
        //     })
        //     .catch((error) => {
        //         console.log("@@ " + error);
        //     });

        // getSummary_Prompt({
        //     recId: this.recordId
        //     })
        //     .then((result) => {
        //         console.log(">> " + result);
        //         this.einsteinLoading = false;
        //         this.summaryTrans = true;
        //         this.summary = result;

        //         if(result) {

        //             voiceDetails_prompt({
        //                 recId: this.recordId,
        //                 engTranscript: result
        //                 })
        //                 .then((result1) => {
        //                     console.log(">> " + result1);                        
        //                 })
        //                 .catch((error) => {
        //                     console.log("@@ " + JSON.stringify(error));
        //                 });

        //         }
        //     })
        //     .catch((error) => {
        //         console.log("@@ " + error);
        //     });

        // getSummary_External2({
        //     recId: this.recordId
        //     })
        //     .then((result) => {
        //         console.log(">> " + result);
        //         this.einsteinLoading = false;
        //         this.summaryTrans = true;
        //         this.summary_External = result;
        //     })
        //     .catch((error) => {
        //         console.log("@@ " + error);
        //     });
    }

    delayTime() {

    setTimeout(() => {
        this.load1_1 = true;
        this.load1_2 = false;
        this.load2_1 = true;
        this.load2_2 = false;
        this.load3_1 = true;
        this.load3_2 = false;
        this.load4_1 = true;
        this.load5_2 = false;

        setTimeout(() => {

        this.load1_1 = false;
        this.load1_2 = true;
        this.load2_1 = true;
        this.load2_2 = false;
        this.load3_1 = true;
        this.load3_2 = false;
        this.load4_1 = true;
        this.load5_2 = false;

        setTimeout(() => {

        this.load1_1 = false;
        this.load1_2 = true;
        this.load2_1 = false;
        this.load2_2 = true;
        this.load3_1 = true;
        this.load3_2 = false;
        this.load4_1 = true;
        this.load5_2 = false;

        setTimeout(() => {

        this.load1_1 = false;
        this.load1_2 = true;
        this.load2_1 = false;
        this.load2_2 = true;
        this.load3_1 = false;
        this.load3_2 = true;
        this.load4_1 = true;
        this.load5_2 = false;

    }, this.timeSpan);

    }, this.timeSpan);

    }, this.first_timeSpan);

    }, this.first_timeSpan);
}
}