function init() {
    // Initialize interface
    initElements();
    initEvents();

    // Initialize Webgl
    /** @type {WebGLRenderingContext} */
    const context = canvas.getContext("webgl");

    // Setup shaders
    const shaderProgram = GLProgram(context, VERT_CODE, FRAG_CODE);
    const modelMatrixLocation = context.getUniformLocation(shaderProgram, 'model');
    const projectionMatrixLocation = context.getUniformLocation(shaderProgram, 'projection');
    const scaleLocation = context.getUniformLocation(shaderProgram, 'scale');

    context.useProgram(shaderProgram);

    // Setup 3D objects
    const xGrid = new Grid(context, shaderProgram, 'x', 10);
    const yGrid = new Grid(context, shaderProgram, 'y', 10);
    const zGrid = new Grid(context, shaderProgram, 'z', 10);
    const axes = new Axes(context, shaderProgram, 1000);
    const traceCloud = new TracerCloud();

    // Enable depth test and transparency
    context.enable(context.DEPTH_TEST);

    context.enable(context.BLEND);
    context.blendFunc(context.SRC_ALPHA, context.ONE);

    // Setup perspective projection by setting the shader uniform
    const perspective = MDN.perspectiveMatrix(Math.PI * 0.5, canvas.width / canvas.height, 0.1, 1000);
    context.uniformMatrix4fv(projectionMatrixLocation, false, new Float32Array(perspective));

    // Calls this every frame
    function loop() {
        const tracersCount = parseInt(inputCountTracers.value);
        if (!isNaN(tracersCount) && isFinite(tracersCount)) {
            traceCloud.updateCount(tracersCount, () => {
                const newTrace = new Tracer(context, shaderProgram,
                    [
                        Math.random(),
                        Math.random(),
                        Math.random(),
                        1
                    ]);
                newTrace.update(
                    [
                        Math.random() * 10,
                        Math.random() * 10,
                        Math.random() * 10
                    ]
                );

                return newTrace;
            });
        }

        const maxLength = parseInt(inputMaxLength.value);
        if (!isNaN(maxLength) && isFinite(maxLength)) {
            traceCloud.updateLength(maxLength);
        }

        traceCloud.update(
            (x, y, z) => x + (inputSigma.value * (y - x)) * 0.010,
            (x, y, z) => y + (x * (inputRho.value - z) - y) * 0.010,
            (x, y, z) => z + (x * y - inputBeta.value * z) * 0.010,
        );

        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientWidth;

        // Update the viewport if canvas size changed between frames
        context.viewport(0, 0, canvas.clientWidth, canvas.height);

        // Read input from mouse
        const translationDelta = [0, 0, deltaWheel / 90, 0];
        if (mouseRightDown) {
            translationDelta[0] = (mouseX - prevX) * 0.04;
            translationDelta[1] = -(mouseY - prevY) * 0.04;
        } else if (mouseLeftDown) {
            yRotation += (mouseX - prevX) * 0.01;
            xRotation += (mouseY - prevY) * 0.01;
        }

        // Create rotation matrix to transform the translation
        const viewRotateMatrix = transformRotation(xRotation, yRotation);

        // Transform the new translation based on the direction of the camera
        const transformedDelta = MDN.multiplyPoint(viewRotateMatrix, translationDelta);

        // Updated the saved translation with the new transformed delta
        xOffset += transformedDelta[0];
        yOffset += transformedDelta[1];
        zOffset += transformedDelta[2];
        const translateMatrix = MDN.translateMatrix(xOffset, yOffset, zOffset);

        // Create a rotation matrix to rotate the view
        // The translation and view rotation are opposite to each other so the camera movement makes sense.
        const viewRotationMatrix = viewRotation(xRotation, yRotation);
        const model = MDN.multiplyMatrices(viewRotationMatrix, translateMatrix);

        // Set the model transformation matrix uniform
        context.uniformMatrix4fv(modelMatrixLocation, false, new Float32Array(model));

        // Clear screen color and depth buffers
        context.clearColor(0, 0, 0, 1);
        context.clear(context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT);

        // Draw grids
        // Set scale to 1 to draw grids
        context.uniform1f(scaleLocation, 1);

        if (inputShowAxes.checked) {
            axes.draw();
        }

        if (inputShowXPlane.checked) {
            xGrid.draw();
        }

        if (inputShowYPlane.checked) {
            yGrid.draw();
        }

        if (inputShowZPlane.checked) {
            zGrid.draw();
        }

        // Set scale to 1/10 so the Lorenz attractor is not too big.
        context.uniform1f(scaleLocation, 0.1);
        traceCloud.draw();

        prevX = mouseX;
        prevY = mouseY;
        deltaWheel = 0;

        // Wait for the next frame
        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
}

// Shader codes
const VERT_CODE =
    'uniform mat4 model;' +
    'uniform mat4 projection;' +
    'uniform float scale;' +

    'attribute vec3 coordinates;' +
    'attribute vec4 colours;' +

    'varying lowp vec4 vColour;' +

    'void main(void) {' +
        'vColour = colours;' +
        'gl_Position = projection * model * vec4(coordinates * scale, 1.0);' +
    '}';

const FRAG_CODE =
    'varying lowp vec4 vColour;' +

    'void main(void) {' +
        'gl_FragColor = vColour;' +
    '}';

// Event Variables
let mouseX,
    mouseY,
    prevX,
    prevY,
    mouseLeftDown,
    mouseRightDown,
    preventContextMenu,
    deltaWheel = 0;

// Camera Variables
let xOffset = 0,
    yOffset = -10,
    zOffset = 0,
    xRotation = Math.PI / 2,
    yRotation = Math.PI;

// HTML Elements
let canvas,
    inputShowAxes,
    inputShowXPlane,
    inputShowYPlane,
    inputShowZPlane,
    inputSigma,
    inputRho,
    inputBeta,
    inputMaxLength,
    inputCountTracers;

/**
 * Create a shader program from vertex and fragment shader codes
 * @param {WebGLRenderingContext} context
 * @param {string} vertexShaderCode
 * @param {string} fragmentShaderCode
 */
function GLProgram(context, vertexShaderCode, fragmentShaderCode) {
    const vertShader = GLShader(context, vertexShaderCode, 'vertex');
    const fragShader = GLShader(context, fragmentShaderCode, 'fragment');

    const shaderProgram = context.createProgram();

    context.attachShader(shaderProgram, vertShader);
    context.attachShader(shaderProgram, fragShader);

    context.linkProgram(shaderProgram);
    return shaderProgram;
}

/**
 * Create a Vertex or Fragment shader from the code, checks for errors
 * @param {WebGLRenderingContext} context
 * @param {string} code
 * @param {'vertex' | 'fragment'} type
 */
 function GLShader(context, code, type) {
    const shaderType = type === 'vertex'
        ? WebGLRenderingContext.VERTEX_SHADER
        : WebGLRenderingContext.FRAGMENT_SHADER;

    const shader = context.createShader(shaderType);
    context.shaderSource(shader, code);
    context.compileShader(shader);

    let error = context.getShaderInfoLog(shader);

    if (error.length > 0) {
        throw new Error(`${type}: {message}`);
    }

    return shader;
}

class Object3D {
    /**
     * @type {WebGLRenderingContext}
     */
    context;

    /**
     * @type {WebGLProgram}
     */
    shaderProgram;

    coordinateLocation;
    colourLocation;

    vertexArray;
    colourArray;
    vertexBuffer;
    colourBuffer;

    drawMode;

    constructor(context, shaderProgram) {
        this.context = context;
        this.shaderProgram = shaderProgram;
        this.coordinateLocation = context.getAttribLocation(shaderProgram, "coordinates");
        this.colourLocation = context.getAttribLocation(shaderProgram, "colours");
        this.vertexArray = [];
        this.colourArray = [];
        this.drawMode = this.context.LINES;
    }

    initBuffers(usage) {
        this.vertexBuffer = this.context.createBuffer();
        this.context.bindBuffer(this.context.ARRAY_BUFFER, this.vertexBuffer);
        this.context.bufferData(this.context.ARRAY_BUFFER, new Float32Array(this.vertexArray), usage || this.context.STATIC_DRAW);

        this.colourBuffer = this.context.createBuffer();
        this.context.bindBuffer(this.context.ARRAY_BUFFER, this.colourBuffer);
        this.context.bufferData(this.context.ARRAY_BUFFER, new Float32Array(this.colourArray), usage || this.context.STATIC_DRAW);

        this.context.bindBuffer(this.context.ARRAY_BUFFER, null);
    }

    /**
     * Draws the object onto the screen
     * @param {WebGLRenderingContext} context
     */
    draw() {
        this.context.bindBuffer(this.context.ARRAY_BUFFER, this.vertexBuffer);
        this.context.vertexAttribPointer(this.coordinateLocation, 3, this.context.FLOAT, false, 0, 0);
        this.context.enableVertexAttribArray(this.coordinateLocation);

        this.context.bindBuffer(this.context.ARRAY_BUFFER, this.colourBuffer);
        this.context.vertexAttribPointer(this.colourLocation, 4, this.context.FLOAT, false, 0, 0);
        this.context.enableVertexAttribArray(this.colourLocation);

        this.context.drawArrays(this.drawMode, 0, this.vertexArray.length / 3);
        this.context.bindBuffer(this.context.ARRAY_BUFFER, null);
    }
}

/**
 * Generic grid object.
 */
class Grid extends Object3D {

    /**
     * Creates a Grid with each edge a unit apart, origin at the middle
     * @param {WebGLRenderingContext} context A webgl rendering context this grid will be bound to.
     * @param {WebGLProgram} shaderProgram A material shader the grid will use
     * @param {'x' | 'y' | 'z'} plane Plane in which the grid will sit
     * @param {number} size How much units will it span to each direction, will be converted to an integer
     */
    constructor(context, shaderProgram, plane, size) {
        super(context, shaderProgram);
        size = Math.round(size);
        for (let i = -size; i <= size; i++) {
            if (plane === 'x') {
                // An edge along x axis
                this.vertexArray.push(-size, i, 0);
                this.vertexArray.push(size, i, 0);
                this.colourArray.push(1, 1, 1, 0.05);
                this.colourArray.push(1, 1, 1, 0.05);

                // An edge along y axis
                this.vertexArray.push(i, -size, 0);
                this.vertexArray.push(i, size, 0);
                this.colourArray.push(1, 1, 1, 0.05);
                this.colourArray.push(1, 1, 1, 0.05);
            } else if (plane === 'y') {
                // An edge along y axis
                this.vertexArray.push(0, -size, i);
                this.vertexArray.push(0, size, i);
                this.colourArray.push(1, 1, 1, 0.05);
                this.colourArray.push(1, 1, 1, 0.05);

                // An edge along z axis
                this.vertexArray.push(0, i, -size);
                this.vertexArray.push(0, i, size);
                this.colourArray.push(1, 1, 1, 0.05);
                this.colourArray.push(1, 1, 1, 0.05);
            } else if (plane === 'z') {
                // An edge along x axis
                this.vertexArray.push(-size, 0, i);
                this.vertexArray.push(size, 0, i);
                this.colourArray.push(1, 1, 1, 0.05);
                this.colourArray.push(1, 1, 1, 0.05);

                // An edge along z axis
                this.vertexArray.push(i, 0, -size);
                this.vertexArray.push(i, 0, size);
                this.colourArray.push(1, 1, 1, 0.05);
                this.colourArray.push(1, 1, 1, 0.05);
            }
        }

        super.initBuffers();
    }
}

/**
 * Object that represent the Red, Green and Blue lines on the view
 */
class Axes extends Object3D {

    /**
     * Creates a Axes object
     * @param {WebGLRenderingContext} context A webgl rendering context this grid will be bound to.
     * @param {WebGLProgram} shaderProgram A material shader the grid will use
     * @param {number} size How much units will it span to each direction, will be converted to an integer
     */
    constructor(context, shaderProgram, size) {
        super(context, shaderProgram);

        // Red axis
        this.vertexArray.push(-size, 0, 0);
        this.vertexArray.push(size, 0, 0);
        this.colourArray.push(1, 0, 0, 1);
        this.colourArray.push(1, 0, 0, 1);

        // Green axis
        this.vertexArray.push(0, -size, 0);
        this.vertexArray.push(0, size, 0);
        this.colourArray.push(0, 1, 0, 1);
        this.colourArray.push(0, 1, 0, 1);

        // Blue axis
        this.vertexArray.push(0, 0, -size);
        this.vertexArray.push(0, 0, size);
        this.colourArray.push(0, 0, 1, 1);
        this.colourArray.push(0, 0, 1, 1);

        super.initBuffers();
    }
}

/**
 * Updatable object that display traces
 */
class Tracer extends Object3D {
    traceColour;
    maxLength = 1000;

    /**
     * Creates a empty traces object
     * @param {WebGLRenderingContext} context A webgl rendering context this grid will be bound to.
     * @param {WebGLProgram} shaderProgram A material shader the grid will use
     * @param {[number, number, number, number]} colour A colour for the trace
     */
    constructor(context, shaderProgram, colour) {
        super(context, shaderProgram);
        super.initBuffers(this.context.DYNAMIC_DRAW);
        this.traceColour = colour;
        this.drawMode = this.context.LINE_STRIP;
    }

    /**
     * Adds a new point to this trace, remove older ones if the number of points is larger than this.maxLength
     * @param {[number, number, number]} point A new vertex to the trace
     */
    update(point) {
        this.vertexArray.push(...point);
        this.colourArray.push(...this.traceColour);

        while (this.vertexArray.length / 3 > this.maxLength) {
            this.vertexArray.shift();
        }

        while (this.colourArray.length / 4 > this.maxLength) {
            this.colourArray.shift();
        }

        this.context.bindBuffer(this.context.ARRAY_BUFFER, this.vertexBuffer);
        this.context.bufferData(this.context.ARRAY_BUFFER, new Float32Array(this.vertexArray), this.context.DYNAMIC_DRAW);

        this.context.bindBuffer(this.context.ARRAY_BUFFER, this.colourBuffer);
        this.context.bufferData(this.context.ARRAY_BUFFER, new Float32Array(this.colourArray), this.context.DYNAMIC_DRAW);
    }
}

/**
 * An utility object to manage multiple tracer objects
 */
class TracerCloud {
    /**
     * @type {Tracer[]}
     */
    tracers;

    /**
     * Creates an empty tracer cloud object
     */
    constructor() {
        this.tracers = [];
    }

    /**
     * Update the size of the cloud
     * @param {number} count The desired size
     * @param {() => Tracer} createNewFunction A function to create tracers
     */
    updateCount(count, createNewFunction) {
        while (this.tracers.length < count) {
            const tracer = createNewFunction();
            this.tracers.push(tracer);
        }

        while (this.tracers.length > count) {
            this.tracers.pop();
        }
    }

    /**
     * Updates how long tracer can be
     * @param {number} maxLength
     */
    updateLength(maxLength) {
        for (const tracer of this.tracers) {
            tracer.maxLength = maxLength;
        }
    }

    /**
     * Apply transformation functions based on the previous value of each trace
     * @param {(number, number, number) => number} xFunc Transformation function to X axis
     * @param {(number, number, number) => number} yFunc Transformation function to Y axis
     * @param {(number, number, number) => number} zFunc Transformation function to Z axis
     */
    update(xFunc, yFunc, zFunc) {
        for (const tracer of this.tracers) {
            let x = 0;
            let y = 0;
            let z = 0;

            if (tracer.vertexArray.length >= 3) {
                x = tracer.vertexArray[tracer.vertexArray.length - 3];
                y = tracer.vertexArray[tracer.vertexArray.length - 2];
                z = tracer.vertexArray[tracer.vertexArray.length - 1];
            }

            // Apply functions
            const tX = xFunc(x, y, z);
            const tY = yFunc(x, y, z);
            const tZ = zFunc(x, y, z);

            // Update trace
            tracer.update([tX, tY, tZ]);
        }
    }

    /**
     * Draw traces to the screen
     */
    draw() {
        for (const tracer of this.tracers) {
            tracer.draw();
        }
    }
}

function initElements() {
    canvas = document.getElementById('canvas');
    inputShowAxes = document.getElementById('show-axes');
    inputShowXPlane = document.getElementById('show-x-plane');
    inputShowYPlane = document.getElementById('show-y-plane');
    inputShowZPlane = document.getElementById('show-z-plane');
    inputSigma = document.getElementById('sigma-input');
    inputRho = document.getElementById('rho-input');
    inputBeta = document.getElementById('beta-input');
    inputMaxLength = document.getElementById('max-length-input');
    inputCountTracers = document.getElementById('traces-count-input');
}

function initEvents() {
    canvas.onmousemove = (event) => {
        mouseX = event.x;
        mouseY = event.y;
    }

    canvas.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        if (ev.button === 0) {
            mouseLeftDown = true;
        } else if (ev.button === 2) {
            preventContextMenu = true;
            mouseRightDown = true;
        }
    });

    document.addEventListener('contextmenu', event => {
        if (preventContextMenu) {
            event.preventDefault()
            preventContextMenu = false;
        }
    });

    canvas.addEventListener('wheel', event => {
        deltaWheel = event.deltaY;
    })

    document.onmouseup = (ev) => {
        ev.preventDefault();
        if (ev.button === 0) {
            mouseLeftDown = false;
        } else if (ev.button === 2) {
            mouseRightDown = false;
        }
    }
}

function setup(rho, sigma, beta, length, count) {
    debugger;
    inputRho.value = rho;
    inputSigma.value = sigma;
    inputBeta.value = beta;
    inputMaxLength.value = length;
    inputCountTracers.value = count;
}

function transformRotation(xRotation, yRotation) {
    const transformRotationX = MDN.rotateXMatrix(xRotation);
    const transformRotationY = MDN.rotateYMatrix(yRotation);
    return MDN.multiplyMatrices(transformRotationY, transformRotationX);
}

function viewRotation(xRotation, yRotation) {
    const viewXRotation = MDN.rotateXMatrix(-xRotation);
    const viewYRotation = MDN.rotateYMatrix(-yRotation);
    return MDN.multiplyMatrices(viewXRotation, viewYRotation);
}
