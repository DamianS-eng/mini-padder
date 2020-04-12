/**
 * @typedef {Object} SkinSlot
 * @memberOf GamepadRenderer#
 * @description data required to draw gamepad changes to canvases in the corresponding gamepad slot
 *
 * @property {gamepadId} gamepadId
 * gamepadId of the gamepad included in processedGamepadChange
 * when the slot is made. It is used for the GamepadRenderer to tell
 * if the gamepad which issued the change has changed, that it needs to
 * recreate a skin slot for the new gamepad.
 *
 * @property {{left: boolean, right: boolean}} stickButtonState
 * last stick button state, stored for rendering.
 *
 * Why is it in a renderer class?
 * MappingManager will always only transfer 'changes',
 * which works for usages that don't need to bind anything together:
 * a logic dealing each of the inputs separately can only work whenever
 * a change occurred therefore it's transferred from MappingManager,
 * and it won't be out of sync to a present state of the gamepad.
 *
 * But here the renderer will try to draw button press states
 * 'on' the position of each sticks, which should be updated every time
 * a corresponding stick moves, regardless of changes on the buttons.
 *
 * So it should bind the position and the button state of a stick.
 *
 * Stick position is always included in processedGamepadChange
 * to avoid stick state considered 'inactive' when it's pushed
 * all the way along a single axis.
 * And with that, the renderer only need to remember the other one,
 * the button state of the stick.
 *
 * @property {HTMLImageElement[]} src
 * reference to an image element containing a spritesheet,
 * ordered by config.json.
 *
 * @property {HTMLCanvasElement[]} layer
 * canvas element for each layers, ordered by config.json.
 *
 * @property {CanvasRenderingContext2D[]} ctx
 * canvas context for each layers, ordered by config.json.
 *
 * @property {Object} instruction
 * specific data to draw each sprites,
 * mapped in a form of processedGamepadChange.
 * It's a reference to `config.sticks` and `config.buttons`.
 */
/**
 *
 * @class
 */
class GamepadRenderer {
  /**
   *
   * @param {HTMLDivElement[]} canvasArray contains divs for each set of canvas
   */
  constructor (canvasArray) {
    this.renderPending = true
    
    this.loadOrders()
    this.loadInstructions()
    this.followInstructions.bind(this)
  
    this.canvas = canvasArray
    // I give it default values I used when it was 'XBoxPadViewer'.
    /**
     * @typedef {Object} fadeoutOption
     * @description
     * Configuration values for fade-out effect.
     * @property {Number[]} time Seconds for each fade-out level.
     * @property {Number[]} opacity Transparency values for each level.
     * @property {Number} duration Transition time of fade-out effect.
     */
    this.fadeout = {
      time: [8,16,32],
      opacity: [0.5,0.1,0],
      duration: 4
    }
  
    this.loadFadeoutOption()
    /**
     * Contains skin data obtained from each `config.json` in their directories. Key value is their directory names.
     * @type {Object.<string, Object>}
     * @property {boolean} loaded `true` when loading is complete
     * @property {string} path
     * path to the skin directory, relative to the root of the page
     * @property {HTMLImageElement[]} src
     * contains image required for the skin
     * @property {Object} config
     * data from `config.json` in the skin directory
     */
    this.skins = {}
    /**
     * Store relations of gamepadId and a skin directory name, as key-value pair.
     * @type {Object.<string, string>}
     */
    this.skinMapping = {}
    this.loadSkinMapping()
    // after finishing loading all, `renderPending` will be `false`.
    this.loadAllStoredSkins()
  
    /**
     * Save references of skins for each gamepad slot. Index is that of the gamepad.
     * @type {SkinSlot[]}
     */
    this.skinSlot = []
    
    this.requestRender = this.requestRender.bind(this)
    this.renderAll = this.renderAll.bind(this)
    
    window.addEventListener('processedGamepadChange', this.requestRender)
    
    this.setSkinMappingInBulk = this.setSkinMappingInBulk.bind(this)
    this.setFadeoutOptionFromArray = this.setFadeoutOptionFromArray.bind(this)
  }
  
  static isDirnameOkay (dirname) {
    return !/[^0-9a-zA-Z_\-]/.test(dirname)
  }
  static announceMessage (message, type) {
    const messageType = {
      log: 'log',
      error: 'error'
    }
    window.dispatchEvent(new CustomEvent('GPVMessage', {
      detail: {
        from: 'Gamepad Renderer',
        type: messageType[type] || messageType.log,
        message: message
      }
    }))
  }
  
  /**
   * Set option values for fade-out effect from
   * an object of properties with the matching type,
   * and create some values based on them,
   * then call `saveFadeoutOption` to save the values to the local storage.
   *
   * If `optionObj` is not given, it will try to save the default values
   * declared in the constructor instead.
   *
   * All the other variations of this method should eventually call this method.
   *
   * @param {?Object} optionObj
   * @param {number[]} optionObj.time Seconds for each fade-out level.
   * @param {number[]} optionObj.opacity Transparency values for each level.
   * @param {number} optionObj.duration Transition time of fade-out effect.
   */
  setFadeoutOption (optionObj) {
    if (optionObj) {
      this.fadeout.time = optionObj.time || [0]
      this.fadeout.opacity = optionObj.opacity || [1]
      this.fadeout.duration = Number(optionObj.duration) || 0
    }
    const opacityOrder = this.fadeout.opacity
    const fadeoutFps = 30
    const deltaOpacity = []
    for (let i = 0; i < opacityOrder.length; i++) {
      if (opacityOrder[i] >= 1) {
        deltaOpacity.push(0)
        continue
      } else if (opacityOrder[i] <= 0) {
        deltaOpacity.push(1)
        continue
      }
      const pastValue = opacityOrder[i-1] || 1
      const diffRate = opacityOrder[i] / pastValue
      deltaOpacity.push( diffRate**( 1/fadeoutFps ) )
    }
    this.fadeout.deltaOpacity = deltaOpacity
    
    this.saveFadeoutOption()
  }
  /**
   * Convert fade-out options given in input elements
   * into a number array / number and save the converted value to the instance.
   *
   * @param {Object.<string, string>} optionObj
   * @param {string} optionObj.time Seconds for each fade-out level.
   * A string made of numbers and separating commas.
   * @param {string} optionObj.opacity Transparency values for each level.
   * A string made of numbers and separating commas.
   * @param {string} optionObj.duration Transition time of fade-out effect.
   * One number value in string type.
   */
  setFadeoutOptionFromStringObject (optionObj) {
    const convertIntoArray =
      v => v.split(',')
        .map(v => Number(v))
        .filter(v => !isNaN(v))
    
    this.setFadeoutOption({
      time: convertIntoArray(optionObj.time || '0'),
      opacity: convertIntoArray(optionObj.opacity || '1'),
      duration: Number(optionObj.duration) || 0
    })
  }
  setFadeoutOptionFromArray (optionArray) {
    if (!optionArray) {
      // set as the default values declared in the constructor instead
      this.setFadeoutOption()
      return false
    }
    const optionObj = {
      time: optionArray[0],
      opacity: optionArray[1],
      duration: optionArray[2]
    }
    this.setFadeoutOptionFromStringObject(optionObj)
  }
  getFadeoutOptionAsTextArray () {
    return [
      this.fadeout.time.join(','),
      this.fadeout.opacity.join(','),
      this.fadeout.duration.toString()
    ]
  }
  saveFadeoutOption () {
    const optionJSON = JSON.stringify(this.fadeout)
    window.localStorage.setItem('fadeOption', optionJSON)
  }
  loadFadeoutOption () {
    const fadeOutOption = JSON.parse(window.localStorage.getItem('fadeOption'))
    this.setFadeoutOption(fadeOutOption || this.fadeout || {})
  }
  
  setSkinMapping (gamepadId, skinDirname) {
    if (!GamepadRenderer.isDirnameOkay(skinDirname)) { return false }
    this.skinMapping[gamepadId] = skinDirname
    this.saveSkinMapping()
  }
  setSkinMappingInBulk (idDirnamePairs) {
    if (
      typeof idDirnamePairs !== 'object' ||
      Object.keys(idDirnamePairs).length === 0
    ) {
      return false
    }
    
    this.resetSkinMapping()
    for (const gamepadId in idDirnamePairs) {
      this.setSkinMapping(gamepadId, idDirnamePairs[gamepadId])
    }
    this.saveSkinMapping()
    
    return true
  }
  saveSkinMapping () {
    const mappingJSON = JSON.stringify(this.skinMapping)
    window.localStorage.setItem('rendererSkinMapping', mappingJSON)
  }
  resetSkinMapping () {
    for (const gamepadId in this.skinMapping) {
      if (!this.skinMapping.hasOwnProperty(gamepadId)) { continue }
      delete this.skinMapping[gamepadId]
    }
  }
  loadSkinMapping () {
    const rendererSkinMapping = JSON.parse(window.localStorage.getItem('rendererSkinMapping'))
    this.skinMapping = rendererSkinMapping || this.skinMapping || {}
  }
  loadAllStoredSkins () {
    const dirnameSeen = {}
    const allSkinDirnames = Object.values(this.skinMapping)
      .filter(dirname => {
        return dirnameSeen.hasOwnProperty(dirname) ?
          false : (dirnameSeen[dirname] = true)
      })
    for (let d = 0; d < allSkinDirnames.length; d++) {
      this.loadSkin(allSkinDirnames[d])
    }
    this.renderPending = false
  }
  /**
   * loads a skin and store the config under `this.skins[dirname]`.
   * @param {string} dirname directory name for the skin
   */
  loadSkin (dirname) {
    if (!GamepadRenderer.isDirnameOkay(dirname)) { return false }
    if (
      this.skins[dirname] &&
      typeof this.skins[dirname].loaded === 'boolean'
    ) { return true }
    this.skins[dirname] = {
      loaded: false
    }
    const skin = this.skins[dirname]
    const path = `./skin/${dirname}`
    fetch(`${path}/config.json`)
      .then(response => response.json())
      .then(data => {
        skin.path = path
        skin.config = data
        skin.src = []
        for (let i = 0; i < skin.config.src.length; i++) {
          skin.src[i] = new Image()
          skin.src[i].src = `${skin.path}/${skin.config.src[i]}`
        }
        skin.loaded = true
        GamepadRenderer.announceMessage(
          `Skin '${skin.config.name}' is loaded.`
        )
      })
      .catch(error => {
        delete this.skins[dirname]
        GamepadRenderer.announceMessage(error, 'error')
      })
  }
  /**
   * setup a loaded skin for one of four canvas
   * @param {string} dirname directory name for the skin
   * @param {number} slot index for one of four canvas
   * @param {gamepadId} gamepadId gamepad the skin is set to be used for
   */
  applySkinToSlot (dirname, slot, gamepadId) {
    if (!this.skins[dirname] || typeof slot === 'undefined') {
      this.loadSkin(dirname)
      return false
    }
    if (!this.skins[dirname].loaded) { return false }
    
    const skin = this.skins[dirname]
    const config = skin.config
  
    const canvas = this.canvas[slot]
    this.skinSlot[slot] = {}
    /** @type {SkinSlot} */
    const skinSlot = this.skinSlot[slot]
    
    skinSlot.gamepadId = gamepadId
    skinSlot.src = skin.src
    skinSlot.layer = []
    skinSlot.ctx = []
    skinSlot.instruction = {
      sticks: skin.config.sticks,
      buttons: skin.config.buttons
    }
    /**
     * Stores the last seen states of sticks and buttons.
     *
     * Value is boolean, the structure follows that of the skin config,
     * and a stick value represents the state of its button.
     * - it's very hard to put a stick to a perfect stop outside of it's
     * centre position.
     *
     * @type {Object}
     */
    skinSlot.activeState = {}
    /**
     * Contains timestamp the last time a stick or a button is active.
     *
     * @type {Object}
     */
    skinSlot.lastActive = {}
    
    for (let l = 0; l < config.layer.length; l++) {
      const layer = document.createElement('canvas')
      layer.setAttribute('width', config.layer[l].width)
      layer.setAttribute('height', config.layer[l].height)
      layer.style.top = config.layer[l].y + 'px'
      layer.style.left = config.layer[l].x + 'px'
      
      skinSlot.layer.push(layer)
      skinSlot.ctx.push(layer.getContext('2d'))
      canvas.appendChild(layer)
    }
  }
  removeSkinFromSlot (slot) {
    delete this.skinSlot[slot].gamepadId
    delete this.skinSlot[slot].stickButtonState
    delete this.skinSlot[slot].src
    delete this.skinSlot[slot].layer
    delete this.skinSlot[slot].ctx
    delete this.skinSlot[slot].instruction
    delete this.skinSlot[slot]
    while (this.canvas[slot].firstChild) {
      this.canvas[slot].removeChild(this.canvas[slot].lastChild)
    }
  }
  
  /**
   *
   * @param {MappingManager#processedGamepadChange} e
   * @listens MappingManager#processedGamepadChange
   * @returns {boolean} `true` if the render could be started,
   * instead of already being started at the time of request.
   */
  requestRender (e) {
    if (this.renderPending) { return false }
    if (!e.detail) {
      GamepadRenderer.announceMessage(
        'Type of the received `processedGamepadChange` event is different.',
        'error'
      )
      return false
    }
    this._e = e.detail
    this.renderPending = true
    requestAnimationFrame(this.renderAll)
    
    return true
  }
  renderAll (timestamp) {
    this.renderPending = false
    if (!this._e) { return false }
    
    /**
     * @type {DOMHighResTimeStamp}
     * @description Contains a timestamp at the moment `renderAll` just started running.
     */
    this._timestamp = timestamp || performance.now()
    
    for (
      let gamepadIndex = 0;
      gamepadIndex < this._e.length;
      gamepadIndex++
    ) {
      if (!this._e[gamepadIndex]) { continue }
      
      const skinSlot = this.skinSlot[gamepadIndex]
      /** @type {processedGamepadChange} */
      const gamepadChange = this._e[gamepadIndex]
  
      if (skinSlot) {
        // skinSlot already exists
        if (skinSlot.gamepadId === gamepadChange.id.gamepadId) {
          // it's the same slot used before
          this.render(gamepadIndex)
        } else {
          // the gamepad for the slot is changed
          this.removeSkinFromSlot(gamepadIndex)
          this.applySkinToSlot(
            this.skinMapping[gamepadChange.id.gamepadId],
            gamepadIndex,
            gamepadChange.id.gamepadId
          )
          if (
            this.skins[this.skinMapping[gamepadChange.id.gamepadId]] &&
            this.skins[this.skinMapping[gamepadChange.id.gamepadId]].loaded
          ) {
            this.renderFrame(gamepadIndex)
          }
        }
      } else {
        // skinSlot isn't made
        // find skin for the gamepad
        const newSkinDirname =
          this.skinMapping[gamepadChange.id.gamepadId] ||
          (/XInput/i.test(gamepadChange.id.gamepadId) ? 'XInput' : 'DInput')
        if (!newSkinDirname) {
          GamepadRenderer.announceMessage({
            message: 'Can\'t assign a skin directory name for the gamepad.',
            processedGamepadChange: gamepadChange
          }, 'error')
          continue
        }
        this.setSkinMapping(gamepadChange.id.gamepadId, newSkinDirname)
        this.applySkinToSlot(
          newSkinDirname, gamepadIndex, gamepadChange.id.gamepadId
        )
        if (
          this.skins[newSkinDirname] &&
          this.skins[newSkinDirname].loaded
        ) {
          this.renderFrame(gamepadIndex)
        }
      }
    }
    
    this._e = null
    this._timestamp = null
    window.dispatchEvent(new CustomEvent('lastActiveChange', {
      detail: this.skinSlot[0].activeState
    }))
  }
  render (gamepadIndex) {
    const src = this.skinSlot[gamepadIndex].src
    const ctx = this.skinSlot[gamepadIndex].ctx
    const inst = this.skinSlot[gamepadIndex].instruction
    if (!src || !ctx || !inst) {
      GamepadRenderer.announceMessage({
        message: 'Renderer is ready to draw but tools are somehow missing.',
        skinSlot: this.skinSlot[gamepadIndex]
      }, 'error')
      return false
    }
  
    const activeState = this.skinSlot[gamepadIndex].activeState
    
    /** @type {{left: ?stickChange, right: ?stickChange}} */
    const sticks = this._e[gamepadIndex].sticks
    const stickLayerIndex = inst.sticks.layer
    
    // give instructions for sticks
    for (let s = 0; s < this.order.stick.length; s++) {
      const stickName = this.order.stick[s]
      
      // only proceed to render when stick change is found
      if (sticks[stickName]) {
        const values = sticks[stickName]
        
        // update active state last seen
        activeState.sticks[stickName][0] = values.active
        if (values.pressed !== null) {
          // only update button state when a change is found,
          // otherwise keep the last seen state
          activeState.sticks[stickName][1] = values.pressed
        }
        
        const stickInst = inst.sticks[stickName]
        // skip if the referred instruction is not made
        if (!stickInst || stickInst.constructor !== Object) { continue }
  
        this.followInstructions(ctx[stickLayerIndex], src, stickInst.clear, null, null, null)
        if (activeState.sticks[stickName][1]) {
          this.followInstructions(ctx[stickLayerIndex], src, stickInst.on, values.value, null, values.delta)
        } else {
          this.followInstructions(ctx[stickLayerIndex], src, stickInst.off, values.value, null, values.delta)
        }
      }
    }
    
    /**
     *  @type {Object}
     *  @property {?Object.<string, ?(buttonChange|basicButtonChange)>} dpad
     *  @property {?Object.<string, ?buttonChange>} face
     *  @property {?Object.<string, ?buttonChange>} shoulder
     */
    const buttons = this._e[gamepadIndex].buttons
    const buttonLayerIndex = inst.buttons.layer
    
    // give instructions for buttons
    for (let bg = 0; bg < this.order.buttonGroup.length; bg++) {
      const buttonGroupName = this.order.buttonGroup[bg]
      
      // check for changes for a button group
      if (!buttons[buttonGroupName]) {
        continue
      }
      
      // changes for a button group is confirmed
      for (let b = 0; b < this.order.button[bg].length; b++) {
        const buttonName = this.order.button[bg][b]
        // check if there was a change on the button
        if (!buttons[buttonGroupName][buttonName]) {
          continue
        }
        
        // change for the button is confirmed
        const value = buttons[buttonGroupName][buttonName].value
        const buttonInst = inst.buttons[buttonGroupName][buttonName]
        // skip if the referred instruction is not made
        if (!buttonInst || buttonInst.constructor !== Object) { continue }
        
        this.followInstructions(ctx[buttonLayerIndex], src, buttonInst.clear, null, null, null)
        // comparing to 0 so that analog buttons with non-zero value
        // will be drawn with 'on' instruction
        if (value === 0) {
          this.followInstructions(ctx[buttonLayerIndex], src, buttonInst.off, null, null, null)
          activeState.buttons[buttonGroupName][buttonName] = false
        } else {
          this.followInstructions(ctx[buttonLayerIndex], src, buttonInst.on, value, null, null)
          activeState.buttons[buttonGroupName][buttonName] = true
        }
      }
    }
  }
  renderFadeout (gamepadIndex, timestamp) {
    const src = this.skinSlot[gamepadIndex].src
    const ctx = this.skinSlot[gamepadIndex].ctx
    const inst = this.skinSlot[gamepadIndex].instruction
    if (!src || !ctx || !inst) {
      GamepadRenderer.announceMessage({
        message: 'Renderer is ready to draw but tools are somehow missing.',
        skinSlot: this.skinSlot[gamepadIndex]
      }, 'error')
      return false
    }
  
    const activeState = this.skinSlot[gamepadIndex].activeState
    const lastActive = this.skinSlot[gamepadIndex].lastActive
    const timestampAtStart = this._timestamp || performance.now()
  }
  
  /**
   * Render the frame of the skin, to show every part of skin.
   * @param {number} gamepadIndex
   * @see GamepadRenderer#render
   */
  renderFrame (gamepadIndex) {
    const src = this.skinSlot[gamepadIndex].src
    const ctx = this.skinSlot[gamepadIndex].ctx
    const inst = this.skinSlot[gamepadIndex].instruction
    if (!src || !ctx || !inst) {
      GamepadRenderer.announceMessage({
        message: 'Renderer is ready to draw but tools are somehow missing.',
        skinSlot: this.skinSlot[gamepadIndex]
      }, 'error')
      return false
    }
  
    const activeState = this.skinSlot[gamepadIndex].activeState
    const lastActive = this.skinSlot[gamepadIndex].lastActive
    const timestampAtStart = this._timestamp || performance.now()
    
    const stickLayerIndex = inst.sticks.layer
    const buttonLayerIndex = inst.buttons.layer
    
    activeState.sticks = activeState.sticks || {}
    lastActive.sticks = lastActive.sticks || {}
    
    for (let s = 0; s < this.order.stick.length; s++) {
      const stickName = this.order.stick[s]
      const stickInst = inst.sticks[stickName]
      if (!stickInst || stickInst.constructor !== Object) { continue }
      this.followInstructions(ctx[stickLayerIndex], src, stickInst.clear, null, null, null)
      this.followInstructions(ctx[stickLayerIndex], src, stickInst.off, [0, 0, null], null, [0, 0, null])
      
      // for stick movement and stick button
      activeState.sticks[stickName] = [false, false]
      lastActive.sticks[stickName] = timestampAtStart
    }
    
    activeState.buttons = activeState.buttons || {}
    lastActive.buttons = lastActive.buttons || {}
    
    for (let bg = 0; bg < this.order.buttonGroup.length; bg++) {
      const buttonGroupName = this.order.buttonGroup[bg]
      
      activeState.buttons[buttonGroupName] =
        activeState.buttons[buttonGroupName] || {}
      lastActive.buttons[buttonGroupName] =
        lastActive.buttons[buttonGroupName] || {}
        
      for (let b = 0; b < this.order.button[bg].length; b++) {
        const buttonName = this.order.button[bg][b]
        const buttonInst = inst.buttons[buttonGroupName][buttonName]
        if (!buttonInst || buttonInst.constructor !== Object) { continue }
        this.followInstructions(ctx[buttonLayerIndex], src, buttonInst.clear, null, null, null)
        this.followInstructions(ctx[buttonLayerIndex], src, buttonInst.off, null, null, null)
        
        activeState.buttons[buttonGroupName][buttonName] = false
        lastActive.buttons[buttonGroupName][buttonName] = timestampAtStart
      }
    }
  }
  
  followInstructions (ctx, src, inst, value, alpha, additionalValue) {
    // `this` is bound as `GamepadRenderer` in the constructor
    for (let i = 0; i < inst.length; i++) {
      const instName = inst[i].instruction
      const instArgs = []
      for (let a = 0; a < this.instructionParameters[instName].length; a++) {
        const parameterName = this.instructionParameters[instName][a]
        switch (parameterName) {
          case 'ctx':
            instArgs.push(ctx)
            break
          case 'src':
            instArgs.push(src[inst[i].src])
            break
          case 'value':
          case 'pos':
            instArgs.push(value)
            break
          case 'alpha':
            instArgs.push(typeof alpha === 'number' ? alpha : 1)
            break
          default:
            if(inst[i].hasOwnProperty(parameterName)) {
              instArgs.push(inst[i][parameterName])
            }
        }
      }
      this.instruction[instName](...instArgs, additionalValue)
    }
  }
  
  /**
   * This method is to define many drawing instructions inside the class,
   * so render method can use them without redefining them every time.
   */
  loadInstructions () {
    this.instructionParameters = {
      fadeoutRect: ['ctx', 'x', 'y', 'width', 'height', 'alpha'],
      fadeoutPolygon: ['ctx', 'path', 'alpha'],
      clearRect: ['ctx', 'x', 'y', 'width', 'height'],
      clearPolygon: ['ctx', 'path'],
      drawImage: ['ctx', 'src', 'coord', 'alpha'],
      drawImageByPos: ['ctx', 'src', 'pos', 'areaSize', 'coord', 'alpha'],
      drawImageInPolygon: ['ctx', 'src', 'path', 'coord', 'alpha'],
      drawImageInPolygonByValue: ['ctx', 'src', 'value', 'areaWidth', 'path', 'coord', 'alpha'],
      clearParallelogram: ['ctx', 'xMin', 'xMax', 'yMin', 'height', 'skewAway', 'vertical'],
      clearParallelogramByValue: ['ctx', 'value', 'areaWidth', 'xMin', 'xMax', 'yMin', 'height', 'skewAway', 'vertical']
    }
    this.instruction = {
      // 'fadeout*' methods are used several time in a row,
      // so the context state management should be done outside of them!
      fadeoutRect: function (
        ctx, x, y, width, height, alpha
      ) {
        // ctx.save() // do this before
        // ctx.globalCompositeOperation = 'destination-out' // do this before
        ctx.globalAlpha = alpha
        
        ctx.fillRect(x, y, width, height)
        // ctx.restore() // do this after finishing fadeout chain
      },
      fadeoutPolygon: function (
        ctx, path
      ) {
        // ctx.save() // do this before
        // ctx.globalCompositeOperation = 'destination-out' // do this before
        ctx.globalAlpha = alpha
  
        ctx.beginPath()
        for (let p = 0; p < path.length; p=p+2) {
          if (typeof path[p+1] === 'undefined') { continue }
          ctx.lineTo(path[p], path[p+1])
        }
        ctx.closePath()
        ctx.fill()
        // ctx.restore() // do this after finishing fadeout chain
      },
      clearRect: function (
        ctx, x, y, width, height
      ) {
        ctx.clearRect(x, y, width, height)
      },
      clearPolygon: function (
        ctx, path
      ) {
        ctx.save()
        ctx.globalCompositeOperation = 'destination-out'
        ctx.beginPath()
        for (let p = 0; p < path.length; p=p+2) {
          if (typeof path[p+1] === 'undefined') { continue }
          ctx.lineTo(path[p], path[p+1])
        }
        ctx.closePath()
        ctx.fill()
    
        ctx.restore()
      },
      drawImage: function (
        ctx, src, coord, alpha = 1
      ) {
        if (alpha === 0) { return }
        if (alpha !== 1) {
          ctx.save()
          ctx.globalAlpha = alpha
        }
        ctx.drawImage(src, ...coord)
        if (alpha !== 1) {
          ctx.restore()
        }
      },
      drawImageByPos: function (
        ctx, src,
        pos, areaSize, coord,
        alpha = 1
      ) {
        const fixedPos = []
        for (let a = 0; a < 2; a++) {
          fixedPos.push(pos[a] * areaSize[a])
        }
        const fixedCoord = []
        for (let p = 0; p < coord.length; p++) {
          if (coord[p].constructor === Array) {
            for (let a = 0; a < 2; a++) {
              fixedCoord.push(
                fixedPos[a] + (coord[p][a+2] ? 1 : -1) * coord[p][a]
              )
            }
          } else {
            fixedCoord.push(coord[p])
          }
        }
        this.drawImage(
          ctx, src, fixedCoord, alpha
        )
      },
      drawImageInPolygon: function (
        ctx, src, path, coord, alpha = 1
      ) {
        ctx.save()
        if (alpha === 0) { return }
        if (alpha !== 1) { ctx.globalAlpha = alpha }
        ctx.beginPath()
        for (let p = 0; p < path.length; p=p+2) {
          if (typeof path[p+1] === 'undefined') { continue }
          ctx.lineTo(path[p], path[p+1])
        }
        ctx.closePath()
        ctx.clip()
        ctx.drawImage(src, ...coord)
        ctx.restore()
      },
      drawImageInPolygonByValue: function (
        ctx, src,
        value, areaWidth, path,
        coord, alpha = 1
      ) {
        const fixedPath = []
        const width = value * areaWidth
        for (let p = 0; p < path.length; p++) {
          if (path[p].constructor === Array) {
            fixedPath.push(
              path[p][0] + (path[p][1] ? 1 : -1) * width
            )
          } else {
            fixedPath.push(path[p])
          }
        }
        this.drawImageInPolygon(
          ctx, src, fixedPath, coord, alpha
        )
      },
      clearParallelogram: function (
        ctx, xMin, xMax, yMin, height, skewAway = false, vertical = false
      ) {
        ctx.save()
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = 'black'
        
        ctx.beginPath()
        if (!vertical) {
          ctx.moveTo(xMax, yMin)
          ctx.lineTo(xMin, yMin)
          if (!skewAway) {
            ctx.lineTo(xMin - height, yMin + height)
            ctx.lineTo(xMax - height, yMin + height)
          } else {
            ctx.lineTo(xMin + height, yMin + height)
            ctx.lineTo(xMax + height, yMin + height)
          }
        } else {
          ctx.moveTo(yMin, xMax)
          ctx.lineTo(yMin, xMin)
          if (!skewAway) {
            ctx.lineTo(yMin + height, xMin - height)
            ctx.lineTo(yMin + height, xMax - height)
          } else {
            ctx.lineTo(yMin + height, xMin + height)
            ctx.lineTo(yMin + height, xMax + height)
          }
        }
        ctx.closePath()
        ctx.fill()
        
        ctx.restore()
      },
      clearParallelogramByValue: function (
        ctx,
        value, areaWidth, xMin,
        xMax, yMin, height, skewAway = false, vertical = false
      ) {
        const width = value * areaWidth
        this.clearParallelogram(
          ctx, xMin + width, xMax, yMin, height, skewAway, vertical
        )
      }
    }
  }
  
  /**
   * This method is to define gamepad input orders in a way
   * I can hopefully efficiently loop through.
   */
  loadOrders () {
    this.order = {
      stick: ['left','right'],
      buttonGroup: ['dpad', 'face', 'shoulder'],
      button: [
        ['up','down','left','right'],
        ['down','right','left','up','select','start','home','touchpad'],
        ['l1','r1','l2','r2']
      ]
    }
  }
}