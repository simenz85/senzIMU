#include "LSM6DSO.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOSConfig.h"
#include "freertos/portmacro.h"
#include <esp_heap_caps.h>
#include <cstring>
#include <functional>
#include <portmacro.h>
#include "esp_mac.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"



// Konstruktor bleibt leer
LSM6DSOCore::LSM6DSOCore() { }

// I2C-Initialisierung (ersetze Arduino TwoWire durch ESP-IDF i2c_port_t)
status_t LSM6DSOCore::beginCore(uint8_t deviceAddress, i2c_port_t i2cPort)
{
    commInterface = I2C_MODE;
    _i2cPort = i2cPort;
    I2CAddress = deviceAddress;

    uint8_t partID = 0;
    status_t ret = readRegister(&partID, WHO_AM_I_REG);
    if (ret != IMU_SUCCESS) return ret;
    if (partID != 0x6C) return IMU_HW_ERROR;

    return IMU_SUCCESS;
}

// SPI-Initialisierung (ersetze Arduino SPIClass durch spi_device_handle_t, SPISettings entfällt)
status_t LSM6DSOCore::beginSPICore(uint8_t csPin, uint32_t spiPortSpeed, spi_device_handle_t spiDevice) {
    commInterface = SPI_MODE;
    chipSelectPin = csPin;
    _spiDevice = spiDevice;

    // CS als GPIO konfigurieren
    gpio_config_t io_conf = {};
    io_conf.pin_bit_mask = (1ULL << csPin);
    io_conf.mode = GPIO_MODE_OUTPUT;
    io_conf.pull_up_en = GPIO_PULLUP_DISABLE;
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_conf.intr_type = GPIO_INTR_DISABLE;
    gpio_config(&io_conf);

    gpio_set_level((gpio_num_t)csPin, 1); // CS inaktiv (HIGH)

    uint8_t partID = 0;
    status_t ret = readRegister(&partID, WHO_AM_I_REG);
    if (ret != IMU_SUCCESS) return ret;
    if (partID != 0x6C) return IMU_HW_ERROR;

    return IMU_SUCCESS;
}


//****************************************************************************//
//
//  ReadRegisterRegion
//
//  Parameters:
//    *outputPointer -- Pass &variable (base address of) to save read data to
//    address -- register to read
//    numBytes -- number of bytes to read
//
//  Note:  Does not know if the target memory space is an array or not, or
//    if there is the array is big enough.  if the variable passed is only
//    two bytes long and 3 bytes are requested, this will over-write some
//    other memory!
//
//****************************************************************************//

status_t LSM6DSOCore::fifoburstRead(uint8_t* buffer, uint16_t length)
{
    if (length == 0 || buffer == nullptr) return IMU_GENERIC_ERROR;
    // Länge sollte Vielfaches von 7 sein (Tag + 6 Daten pro Frame)

  const uint16_t requiredCapacity = length + 1;
  if (_fifoBurstBufferCapacity < requiredCapacity) {
    uint8_t* newTx = (uint8_t*)heap_caps_malloc(requiredCapacity, MALLOC_CAP_DMA);
    uint8_t* newRx = (uint8_t*)heap_caps_malloc(requiredCapacity, MALLOC_CAP_DMA);
    if (!newTx || !newRx) {
      if (newTx) heap_caps_free(newTx);
      if (newRx) heap_caps_free(newRx);
      return IMU_HW_ERROR;
    }

    if (_fifoBurstTxBuffer) heap_caps_free(_fifoBurstTxBuffer);
    if (_fifoBurstRxBuffer) heap_caps_free(_fifoBurstRxBuffer);

    _fifoBurstTxBuffer = newTx;
    _fifoBurstRxBuffer = newRx;
    _fifoBurstBufferCapacity = requiredCapacity;
    }

  _fifoBurstTxBuffer[0] = FIFO_DATA_OUT_TAG | 0x80; // Adressbyte mit Read-Bit gesetzt
  memset(&_fifoBurstTxBuffer[1], 0x00, length);

    // Manuelles CS Handling
    gpio_set_level((gpio_num_t)chipSelectPin, 0);

    spi_transaction_t t = {};
    t.length = (length + 1) * 8; // Länge in Bits
  t.tx_buffer = _fifoBurstTxBuffer;
  t.rx_buffer = _fifoBurstRxBuffer;

    esp_err_t ret = spi_device_transmit(_spiDevice, &t);

    gpio_set_level((gpio_num_t)chipSelectPin, 1);

    if (ret == ESP_OK) {
    memcpy(buffer, &_fifoBurstRxBuffer[1], length); // rx[0] = Dummy
        return IMU_SUCCESS;
    } else {
        return IMU_HW_ERROR;
    }
}


status_t LSM6DSOCore::readMultipleRegisters(uint8_t outputPointer[], uint8_t address, uint8_t numBytes)
{
    if (outputPointer == nullptr || numBytes == 0) return IMU_GENERIC_ERROR;

    switch (commInterface) {
        case I2C_MODE:
        {
            // I2C-Transaktion mit ESP-IDF APIs
            i2c_cmd_handle_t cmd = i2c_cmd_link_create();
            i2c_master_start(cmd);
            i2c_master_write_byte(cmd, (_i2cPort << 1) | I2C_MASTER_WRITE, true);
            i2c_master_write_byte(cmd, address, true);
            i2c_master_start(cmd);
            i2c_master_write_byte(cmd, (_i2cPort << 1) | I2C_MASTER_READ, true);
            esp_err_t ret = i2c_master_read(cmd, outputPointer, numBytes, I2C_MASTER_LAST_NACK);
            i2c_master_stop(cmd);
            ret = i2c_master_cmd_begin(_i2cPort, cmd, 1000 / portTICK_PERIOD_MS);
            i2c_cmd_link_delete(cmd);
            return (ret == ESP_OK) ? IMU_SUCCESS : IMU_HW_ERROR;
        }

        case SPI_MODE:
        {
#if LSM6DSO_DMA_ENABLED
            if (dmaInitialized) {
                return readMultipleRegisterDMA(address, outputPointer, numBytes);
            }
#endif
            // SPI ohne DMA (manuelles CS Handling)
            gpio_set_level((gpio_num_t)chipSelectPin, 0);

            // Sende Adresse mit Read-Bit
            uint8_t tx_addr = address | SPI_READ_COMMAND;
            spi_transaction_t t_addr = {};
            t_addr.length = 8;
            t_addr.tx_buffer = &tx_addr;
            t_addr.rx_buffer = nullptr;
            esp_err_t ret = spi_device_polling_transmit(_spiDevice, &t_addr);
            if (ret != ESP_OK) {
                gpio_set_level((gpio_num_t)chipSelectPin, 1);
                return IMU_HW_ERROR;
            }

            // Empfang der Bytes
            for (uint8_t i = 0; i < numBytes; i++) {
                uint8_t dummy_tx = 0x00;
                uint8_t rx_byte = 0;

                spi_transaction_t t = {};
                t.length = 8;
                t.tx_buffer = &dummy_tx;
                t.rx_buffer = &rx_byte;
                ret = spi_device_polling_transmit(_spiDevice, &t);
                if (ret != ESP_OK) {
                    gpio_set_level((gpio_num_t)chipSelectPin, 1);
                    return IMU_HW_ERROR;
                }
                outputPointer[i] = rx_byte;
            }

            gpio_set_level((gpio_num_t)chipSelectPin, 1);

            return IMU_SUCCESS;
        }
        default:
            return IMU_GENERIC_ERROR;
    }
}

//****************************************************************************//
//  readRegister
//
//  Parameters:
//    *outputPointer -- Pass &variable (address of) to save read data to
//    address -- register to read
//****************************************************************************//
status_t LSM6DSOCore::readRegister(uint8_t* outputPointer, uint8_t address) 
{
    if (outputPointer == nullptr) return IMU_GENERIC_ERROR;

    switch (commInterface) 
    {
        case I2C_MODE:
        {
            // I2C-Lese-Transaktion mit ESP-IDF APIs
            i2c_cmd_handle_t cmd = i2c_cmd_link_create();
            i2c_master_start(cmd);
            i2c_master_write_byte(cmd, (_i2cPort << 1) | I2C_MASTER_WRITE, true);
            i2c_master_write_byte(cmd, address, true);
            i2c_master_start(cmd);
            i2c_master_write_byte(cmd, (_i2cPort << 1) | I2C_MASTER_READ, true);
            i2c_master_read_byte(cmd, outputPointer, I2C_MASTER_LAST_NACK);
            i2c_master_stop(cmd);
            esp_err_t ret = i2c_master_cmd_begin(_i2cPort, cmd, 1000 / portTICK_PERIOD_MS);
            i2c_cmd_link_delete(cmd);
            return (ret == ESP_OK) ? IMU_SUCCESS : IMU_HW_ERROR;
        }

        case SPI_MODE:
        {
#if LSM6DSO_DMA_ENABLED
            if (dmaInitialized) {
                return readRegisterDMA(outputPointer, address);
            }
#endif
            // SPI Standard-Transaktion ohne DMA
            uint8_t tx_data[2] = { static_cast<uint8_t>(address | SPI_READ_COMMAND), 0x00 };
            uint8_t rx_data[2] = {0};

            // CS LOW
            gpio_set_level((gpio_num_t)chipSelectPin, 0);

            spi_transaction_t t = {};
            t.length = 16;               // Bits
            t.tx_buffer = tx_data;
            t.rx_buffer = rx_data;

            esp_err_t ret = spi_device_transmit(_spiDevice, &t);

            // CS HIGH
            gpio_set_level((gpio_num_t)chipSelectPin, 1);

            if (ret == ESP_OK) {
                *outputPointer = rx_data[1];
                return IMU_SUCCESS;
            }
            else {
                return IMU_HW_ERROR;
            }
        }

        default:
            return IMU_GENERIC_ERROR;
    }
}

#if LSM6DSO_DMA_ENABLED

status_t LSM6DSOCore::readRegisterDMA(uint8_t* outputPointer, uint8_t address) {
    if (outputPointer == nullptr) return IMU_GENERIC_ERROR;

    uint8_t tx_data[2] = { static_cast<uint8_t>(address | SPI_READ_COMMAND), 0x00 };
    uint8_t rx_data[2] = {0};

    spi_transaction_t t = {};
    t.length = 16;  // bits
    t.tx_buffer = tx_data;
    t.rx_buffer = rx_data;

    gpio_set_level((gpio_num_t)chipSelectPin, 0); // CS LOW
    esp_err_t ret = spi_device_transmit(spiDeviceHandle, &t);
    gpio_set_level((gpio_num_t)chipSelectPin, 1); // CS HIGH

    if (ret == ESP_OK) {
        *outputPointer = rx_data[1];
        return IMU_SUCCESS;
    }
    return IMU_HW_ERROR;
}


status_t LSM6DSOCore::readMultipleRegisterDMA(uint8_t address, uint8_t* buffer, uint16_t length) {
  if (length == 0) return IMU_GENERIC_ERROR;

  uint8_t tx[length + 1];
  uint8_t rx[length + 1];
  tx[0] = address | 0x80; // Read-Befehl
  memset(&tx[1], 0x00, length);

  digitalWrite(chipSelectPin, LOW);
  spi_transaction_t t = {};
  t.length = (length + 1) * 8;
  t.tx_buffer = tx;
  t.rx_buffer = rx;
  esp_err_t ret = spi_device_transmit(spiDeviceHandle, &t);
  digitalWrite(chipSelectPin, HIGH);

  if (ret == ESP_OK) {
    memcpy(buffer, &rx[1], length); // Die erste Antwort ist Dummy
    return IMU_SUCCESS;
  }
  return IMU_HW_ERROR;
}

status_t LSM6DSOCore::writeRegisterDMA(uint8_t address, uint8_t dataToWrite) {
    uint8_t tx_data[2] = { static_cast<uint8_t>(address & 0x7F), dataToWrite };

    spi_transaction_t t = {};
    t.length = 16;  // bits
    t.tx_buffer = tx_data;
    t.rx_buffer = nullptr;

    gpio_set_level((gpio_num_t)chipSelectPin, 0); // CS LOW
    esp_err_t ret = spi_device_transmit(spiDeviceHandle, &t);
    gpio_set_level((gpio_num_t)chipSelectPin, 1); // CS HIGH

    return (ret == ESP_OK) ? IMU_SUCCESS : IMU_HW_ERROR;
}



status_t LSM6DSOCore::writeMultipleRegistersDMA(uint8_t inputPointer[], uint8_t address, uint8_t numBytes) {
    if (numBytes == 0) return IMU_GENERIC_ERROR;

    uint8_t tx[numBytes + 1];
    tx[0] = address & 0x7F; // Schreibbefehl, Read-Bit aus
    memcpy(&tx[1], inputPointer, numBytes);

    // CS LOW vor Transfer
    gpio_set_level((gpio_num_t)chipSelectPin, 0);

    spi_transaction_t t = {};
    t.length = (numBytes + 1) * 8;  // Länge in Bits
    t.tx_buffer = tx;
    t.rx_buffer = nullptr;

    esp_err_t ret = spi_device_transmit(spiDeviceHandle, &t);

    // CS HIGH nach Transfer
    gpio_set_level((gpio_num_t)chipSelectPin, 1);

    return (ret == ESP_OK) ? IMU_SUCCESS : IMU_HW_ERROR;
}

#endif




//****************************************************************************//
//  readRegisterInt16
//
//  Parameters:
//    *outputPointer -- Pass &variable (base address of) to save read data to
//    address -- register to read
//****************************************************************************//
status_t LSM6DSOCore::readRegisterInt16(int16_t* outputPointer, uint8_t address) 
{
	uint8_t myBuffer[2];
	status_t returnError = readMultipleRegisters(myBuffer, address, 2);  //Does memory transfer
	int16_t output = myBuffer[0] | static_cast<uint16_t>(myBuffer[1] << 8);
	
	*outputPointer = output;
	return returnError;
}

//****************************************************************************//
//  writeRegister
//
//  Parameters:
//    address -- register to write
//    dataToWrite -- 8 bit data to write to register
//****************************************************************************//
status_t LSM6DSOCore::writeRegister(uint8_t address, uint8_t dataToWrite) {
    switch (commInterface) {
        case I2C_MODE:
        {
            // I2C Schreib-Transaktion mit ESP-IDF APIs
            i2c_cmd_handle_t cmd = i2c_cmd_link_create();
            i2c_master_start(cmd);
            i2c_master_write_byte(cmd, (_i2cPort << 1) | I2C_MASTER_WRITE, true);
            i2c_master_write_byte(cmd, address, true);
            i2c_master_write_byte(cmd, dataToWrite, true);
            i2c_master_stop(cmd);
            esp_err_t ret = i2c_master_cmd_begin(_i2cPort, cmd, 1000 / portTICK_PERIOD_MS);
            i2c_cmd_link_delete(cmd);
            return (ret == ESP_OK) ? IMU_SUCCESS : IMU_HW_ERROR;
        }

        case SPI_MODE:
        {
#if LSM6DSO_DMA_ENABLED
            if (dmaInitialized) {
                return writeRegisterDMA(address, dataToWrite);
            }
#endif
            // SPI ohne DMA mit manuellem CS Handling
            gpio_set_level((gpio_num_t)chipSelectPin, 0);
            uint8_t tx_data[2] = { static_cast<uint8_t>(address & 0x7F), dataToWrite };
            spi_transaction_t t = {};
            t.length = 16; // bits
            t.tx_buffer = tx_data;
            t.rx_buffer = nullptr;
            esp_err_t ret = spi_device_transmit(_spiDevice, &t);
            gpio_set_level((gpio_num_t)chipSelectPin, 1);
            return (ret == ESP_OK) ? IMU_SUCCESS : IMU_HW_ERROR;
        }

        default:
            return IMU_GENERIC_ERROR;
    }
}

//****************************************************************************//
//  writeMultipleRegisters
//
//  Parameters:
//    inputPointer -- array to be written to device
//    address -- register to write
//    numBytes -- number of bytes contained in the array
//****************************************************************************//
status_t LSM6DSOCore::writeMultipleRegisters(uint8_t inputPointer[], uint8_t address, uint8_t numBytes) {
    if (inputPointer == nullptr || numBytes == 0) return IMU_GENERIC_ERROR;

    switch (commInterface) {
        case I2C_MODE:
        {
            i2c_cmd_handle_t cmd = i2c_cmd_link_create();
            i2c_master_start(cmd);
            i2c_master_write_byte(cmd, (_i2cPort << 1) | I2C_MASTER_WRITE, true);
            i2c_master_write_byte(cmd, address, true);
            i2c_master_write(cmd, inputPointer, numBytes, true);
            i2c_master_stop(cmd);
            esp_err_t ret = i2c_master_cmd_begin(_i2cPort, cmd, 1000 / portTICK_PERIOD_MS);
            i2c_cmd_link_delete(cmd);
            return (ret == ESP_OK) ? IMU_SUCCESS : IMU_HW_ERROR;
        }

        case SPI_MODE:

  
        {
            // Manuelles CS-Handling
            gpio_set_level((gpio_num_t)chipSelectPin, 0);

            spi_transaction_t t = {};
            t.length = numBytes * 8;  // Bits
            t.tx_buffer = inputPointer;
            t.rx_buffer = nullptr;

            esp_err_t ret = spi_device_transmit(_spiDevice, &t);

            gpio_set_level((gpio_num_t)chipSelectPin, 1);

            return (ret == ESP_OK) ? IMU_SUCCESS : IMU_HW_ERROR;
        }

        default:
            return IMU_GENERIC_ERROR;
    }
}






status_t LSM6DSOCore::enableEmbeddedFunctions(bool enable)
{
  uint8_t tempVal; 
  readRegister(&tempVal, FUNC_CFG_ACCESS);
  
  tempVal &= 0x7F;

  if( enable )
    tempVal |= 0x80;  
  else
    tempVal |= 0x7F; 

	status_t returnError = writeRegister( FUNC_CFG_ACCESS, tempVal );
	return returnError;
}

//****************************************************************************//
//
//  Main user class -- wrapper for the core class + maths
//
//  Construct with same rules as the core ( uint8_t busType, uint8_t inputArg )
//
//****************************************************************************//
LSM6DSO::LSM6DSO() 
{
	//Construct with these default imuSettings

	imuSettings.gyroEnabled = true;  //Can be 0 or 1
	imuSettings.gyroRange = 500;   //Max deg/s.  Can be: 125, 250, 500, 1000, 2000
	imuSettings.gyroSampleRate = 416;   //Hz.  Can be: 13, 26, 52, 104, 208, 416, 833, 1666
	imuSettings.gyroBandWidth = 400;  //Hz.  Can be: 50, 100, 200, 400;
	imuSettings.gyroFifoEnabled = 0;  //Set to include gyro in FIFO
	imuSettings.gyroAccelDecimation = 1;  //Set to include gyro in FIFO

	imuSettings.accelEnabled = true;
	imuSettings.accelRange = 2;      //Max G force readable.  Can be: 2, 4, 8, 16
	imuSettings.accelSampleRate = 833;  //Hz.  Can be: 1.6 (16), 12.5 (125), 26, 52, 104, 208, 416, 833, 1660, 3330, 6660
	imuSettings.accelFifoEnabled = 1;  //Set to include accelerometer in the FIFO

  imuSettings.fifoEnabled = true;
	imuSettings.fifoThreshold = 3000;  //Can be 0 to 4096 (16 bit bytes)
	imuSettings.fifoSampleRate = 833; 
	imuSettings.fifoModeWord = 0;  //Default off

  imuSettings.LSBSTEP = 25.0 / 1000000.0; // Default LSBSTEP value, will be updated in beginSettings()
  imuSettings.accelScale = 0; // Default scale value, will be updated in beginSettings() 

	allOnesCounter = 0;
	nonSuccessCounter = 0;


}

bool LSM6DSO::begin(uint8_t address, i2c_port_t i2cPort) {
    if (address != DEFAULT_ADDRESS && address != ALT_ADDRESS) {
        return false;
    }

    status_t ret = beginCore(address, i2cPort);
    if (ret != IMU_SUCCESS) {
        return false;
    } else {
        return true;
    }
}

bool LSM6DSO::beginSPI(uint8_t csPin, uint32_t spiPortSpeed, spi_device_handle_t spiDevice) {
    status_t ret = beginSPICore(csPin, spiPortSpeed, spiDevice);
    if (ret != IMU_SUCCESS) {
        return false;
    } else {
        return true;
    }
}

bool LSM6DSO::initialize(uint8_t settings){

  setIncrement();

  if( settings == BASIC_SETTINGS ){
    setAccelRange(8);
    setAccelDataRate(416);
    setGyroRange(500);
    setGyroDataRate(416);
    setBlockDataUpdate(true);
  }
  else if( settings == SOFT_INT_SETTINGS ){
    setAccelRange(8);
    setAccelDataRate(416);
    setGyroRange(500);
    setGyroDataRate(416);
  }
  else if( settings == HARD_INT_SETTINGS ){
    setInterruptOne(INT1_DRDY_XL_ENABLED);
    setInterruptTwo(INT2_DRDY_G_ENABLED); 
    setAccelRange(8);
    setAccelDataRate(416);
    setGyroRange(500);
    setGyroDataRate(416);
  }
  else if( settings == FIFO_SETTINGS ){
    setFifoDepth(9000); // bytes
    //setTSDecimation(); // FIFO_CTRL4
    //getSamplesStored(); // FIFO_STATUS1 and STATUS2
    
    setAccelBatchDataRate(1660);
    setGyroBatchDataRate(0);
    setFifoMode(FIFO_MODE_CONTINUOUS);  
    setAccelRange(2);
    setAccelDataRate(6660);
    setGyroRange(500);
    setGyroDataRate(6660);
    
    
  }
  else if( settings == PEDOMETER_SETTINGS ){
    enableEmbeddedFunctions(true);
    setAccelDataRate(52);
    enablePedometer(true);
  }
  else if( settings == TAP_SETTINGS ){
    setAccelRange(2);
    setAccelDataRate(417); // Must be at least 417
    enableTap(true, true, true, true);
    setTapDirPrior( TAP_PRIORITY_YXZ );
    setXThreshold(9);
    configureTap(0x06);
    routeHardInterOne(INT1_SINGLE_TAP_ENABLED);
    //setTapClearOnRead(true); //TAP_CFG0
  }
  else if( settings == FREE_FALL_SETTINGS ){
    enableEmbeddedFunctions(true);
    //setFreeFall(true);
   // getFreeFall();
  }
 


  setLSBSTEP(); //Set the LSBSTEP value based on the internal frequency fine
  getAccelScale(); // Get the accel scale value for the IMU, will be used in calculations

  return true;

}

status_t LSM6DSO::beginSettings() {

	uint8_t dataToWrite = 0;  //Temporary variable

	//Setup the accelerometer******************************
	dataToWrite = 0; //Start Fresh!
	if ( imuSettings.accelEnabled == 1) {
    //Range
		switch (imuSettings.accelRange) {
		case 2:
			dataToWrite |= FS_XL_2g;
			break;
		case 4:
			dataToWrite |= FS_XL_4g;
			break;
		case 8:
			dataToWrite |= FS_XL_8g;
			break;
		default:  //set default case to 16(max)
		case 16:
			dataToWrite |= FS_XL_16g;
			break;
		}
		// Accelerometer ODR
		switch (imuSettings.accelSampleRate) {
		case 16:
			dataToWrite |= ODR_XL_1_6Hz;
			break;
		case 125:
			dataToWrite |= ODR_XL_12_5Hz;
			break;
		case 26:
			dataToWrite |= ODR_XL_26Hz;
			break;
		case 52:
			dataToWrite |= ODR_XL_52Hz;
			break;
		default:  //Set default to 104
		case 104:
			dataToWrite |= ODR_XL_104Hz;
			break;
		case 208:
			dataToWrite |= ODR_XL_208Hz;
			break;
		case 416:
			dataToWrite |= ODR_XL_416Hz;
			break;
		case 833:
			dataToWrite |= ODR_XL_833Hz;
			break;
		case 1660:
			dataToWrite |= ODR_XL_1660Hz;
			break;
		case 3330:
			dataToWrite |= ODR_XL_3330Hz;
			break;
		case 6660:
			dataToWrite |= ODR_XL_6660Hz;
			break;
		}
	}

  // Write Accelerometer Settings....
	writeRegister(CTRL1_XL, dataToWrite);

	//Setup the gyroscope**********************************************
	dataToWrite = 0; // Clear variable

	if ( imuSettings.gyroEnabled == 1) {
		switch (imuSettings.gyroRange) {
		case 125:
			dataToWrite |=  FS_G_125dps;
			break;
		case 245:
			dataToWrite |=  FS_G_250dps;
			break;
		case 500:
			dataToWrite |=  FS_G_500dps;
			break;
		case 1000:
			dataToWrite |=  FS_G_1000dps;
			break;
		default:  //Default to full 2000DPS range
		case 2000:
			dataToWrite |=  FS_G_2000dps;
			break;
		}
		switch (imuSettings.gyroSampleRate) { 
		case 125:
			dataToWrite |= ODR_GYRO_12_5Hz;
			break;
		case 26:
			dataToWrite |= ODR_GYRO_26Hz;
			break;
		case 52:
			dataToWrite |= ODR_GYRO_52Hz;
			break;
		default:  //Set default to 104
		case 104:
			dataToWrite |= ODR_GYRO_104Hz;
			break;
		case 208:
			dataToWrite |= ODR_GYRO_208Hz;
			break;
		case 416:
			dataToWrite |= ODR_GYRO_416Hz;
			break;
		case 833:
			dataToWrite |= ODR_GYRO_833Hz;
			break;
		case 1660:
			dataToWrite |= ODR_GYRO_1660Hz;
			break;
		case 3330:
			dataToWrite |= ODR_GYRO_3330Hz;
			break;
		case 6660:
			dataToWrite |= ODR_GYRO_6660Hz;
			break;
		}
	}
	
  // Write the gyroscope imuSettings. 
	writeRegister(CTRL2_G, dataToWrite);
  getAccelScale(); // Get the accel scale value for the IMU, will be used in calculations

	return IMU_SUCCESS;
}

// Address: 0x1E , bit[2:0]: default value is: 0x00
// Checks if there is new accelerometer, gyro, or temperature data.
uint8_t LSM6DSO::listenDataReady(){

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, STATUS_REG);
  
  if( returnError != IMU_SUCCESS )
    return IMU_GENERIC_ERROR;
  else
    return regVal; 
}

// Address:0x12 CTRL3_C , bit[6] default value is: 0x00
// This function sets the BDU (Block Data Update) bit. Use when not employing
// the FIFO buffer.
bool LSM6DSO::setBlockDataUpdate(bool enable){

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, CTRL3_C); 
  if( returnError != IMU_SUCCESS )
    return false;
    
  regVal &= 0xBF;
  regVal |= BDU_BLOCK_UPDATE;   

  returnError = writeRegister(CTRL3_C, regVal);  			
  if( returnError != IMU_SUCCESS )
    return false;
  else 
    return true;


}

// Address:0x0D , bit[7:0]: default value is: 0x00
// Sets whether the accelerometer, gyroscope, or FIFO trigger on hardware
// interrupt one. Error checking for the user's argument is tricky (could be a
// long list of "if not this and not this and not this" instead the function relies on the
// user to set the correct value. 
bool LSM6DSO::setInterruptOne(uint8_t setting) {

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, INT1_CTRL);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal &= 0xFE; 
  regVal |= setting; 

  returnError = writeRegister(INT1_CTRL, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}

// Address:0x0D , bit[7:0]: default value is: 0x00
// Gets whether the accelerometer, gyroscope, or FIFO trigger on hardware
// interrupt one.
uint8_t LSM6DSO::getInterruptOne() {

  uint8_t regVal; 
  status_t returnError = readRegister(&regVal, INT1_CTRL);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return regVal;
}

// Address: 0x12, bit[5,4]: default value is: 0x00
// Configures the polarity of the hardware interrupts and whether they are
// push-pull or open-drain. 
bool LSM6DSO::configHardOutInt(uint8_t polarity, uint8_t pushOrDrain) {

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, CTRL3_C);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal &= 0xCF;
  regVal |= polarity;
  regVal |= pushOrDrain;

  returnError = writeRegister(CTRL3_C, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}
// Address:0x0E , bit[7:0]: default value is: 0x00
// Sets whether the accelerometer, gyroscope, temperature sensor or FIFO trigger on hardware
// interrupt two. Error checking for the user's argument is tricky (could be a
// long list of "if not this and not this and not this" instead the function relies on the
// user to set the correct value. 
bool LSM6DSO::setInterruptTwo(uint8_t setting) {

  status_t returnError = writeRegister(INT2_CTRL, setting);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;

}

bool LSM6DSO::setLSBSTEP() {
  // This function sets the LSBSTEP value based on the internal frequency fine
  uint8_t frq;
  readRegister(&frq, INTERNAL_FREQ_FINE);

  imuSettings.LSBSTEP = (1.0 / 40000.0) * (1.0 + 0.0015 * frq) ; // LSBSTEP = 1 / (40kHz * (1 + 0.0015 * frq)) * 1,000,000 ;

  status_t returnError = readRegister(&frq, INTERNAL_FREQ_FINE);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;

}





// Address:0x15 , bit[4]: default value is: 0x00
// Sets whether high performance mode is on for the acclerometer, by default it is ON.
bool LSM6DSO::setHighPerfAccel(bool enable){

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, CTRL6_C);
  if( returnError != IMU_SUCCESS )
    return false; 

  if( enable )
    regVal |=  HIGH_PERF_ACC_ENABLE; 
  else
    regVal |=  HIGH_PERF_ACC_DISABLE; 

  returnError = writeRegister(CTRL6_C, regVal);
  if( returnError != IMU_SUCCESS )
    return false; 
  else
    return true;
}

// Address:0x16 , bit[7]: default value is: 0x00
// Sets whether high performance mode is on for the gyroscope, by default it is ON.
bool LSM6DSO::setHighPerfGyro(bool enable){

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, CTRL7_G);
  if( returnError != IMU_SUCCESS )
    return false; 

  if( enable )
    regVal |=  HIGH_PERF_GYRO_ENABLE; 
  else
    regVal |=  HIGH_PERF_GYRO_DISABLE; 

  returnError = writeRegister(CTRL7_G, regVal);
  if( returnError != IMU_SUCCESS )
    return false; 
  else
    return true;
}

//****************************************************************************//
//
//  Accelerometer section
//
//****************************************************************************//

// Address: 0x10 , bit[4:3]: default value is: 0x00 (2g) 
// Sets the acceleration range of the accleromter portion of the IMU.

bool LSM6DSO::setAccelRange(uint8_t range) {

  if (range > 16)
    return false; 

  uint8_t regVal;
  uint8_t fullScale; 
  status_t returnError = readRegister(&regVal, CTRL1_XL);
  if( returnError != IMU_SUCCESS )
      return false;

  fullScale = getAccelFullScale();

  // Can't have 16g with XL_FS_MODE == 1
  if( fullScale == 1 && range == 16 )
    range = 8;

  regVal &= FS_XL_MASK;

  switch( range ) {
    case 2:
      regVal |= FS_XL_2g;
      break;
    case 4:
      regVal |= FS_XL_4g;
      break;
    case 8:
      regVal |= FS_XL_8g;
      break;
    case 16:
      regVal |= FS_XL_16g;
      break;
    default:
      break;
  }

  returnError = writeRegister(CTRL1_XL, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else {
      getAccelScale(); // Get the accel scale value for the IMU, will be used in calculations
      return true;       
  }
}

// Address: 0x10 , bit[4:3]: default value is: 0x00 (2g) 
// Gets the acceleration range of the accleromter portion of the IMU.
// The value is dependent on the full scale bit (see getAccelFullScale).
uint8_t LSM6DSO::getAccelRange(){

  uint8_t regVal;
  uint8_t fullScale;

  status_t returnError = readRegister(&regVal, CTRL1_XL);
  if( returnError != IMU_SUCCESS )
    return IMU_GENERIC_ERROR;

  fullScale = getAccelFullScale();  
  regVal = (regVal & 0x0C) >> 2; 

  if( fullScale == 1 ){
    switch( regVal ){
      case 0: 
        return 2;
      case 1:
        return 2;
      case 2:
        return 4;
      case 3:
        return 8;
      default:
        return IMU_GENERIC_ERROR;
      }
    }
  else if( fullScale == 0 ){
    switch( regVal ){
      case 0: 
        return 2;
      case 1:
        return 16;
      case 2:
        return 4;
      case 3:
        return 8;
      default:
        return IMU_GENERIC_ERROR;
      }
  }
  else
    return IMU_GENERIC_ERROR;

}

// Address: 0x10, bit[7:4]: default value is: 0x00 (Power Down)
// Sets the output data rate of the accelerometer there-by enabling it. 
bool LSM6DSO::setAccelDataRate(uint16_t rate) {

  if( (rate < 16)  | (rate > 6660)) 
    return false; 

  uint8_t regVal;
  uint8_t highPerf;
  status_t returnError = readRegister(&regVal, CTRL1_XL);
  if( returnError != IMU_SUCCESS )
      return false;

  highPerf = getAccelHighPerf();

  // Can't have 1.6Hz and have high performance mode enabled.
  if( highPerf == 0 && rate == 16 ) 
    rate = 125;

  regVal &= ODR_XL_MASK;

  switch ( rate ) {
    case 0:
      regVal |= ODR_XL_DISABLE;
      break;
    case 16:
      regVal |= ODR_XL_1_6Hz;
      break;
    case 125:
      regVal |= ODR_XL_12_5Hz;
      break;
    case 26:
      regVal |= ODR_XL_26Hz;
      break;
    case 52:
      regVal |= ODR_XL_52Hz;
      break;
    case 104:
      regVal |= ODR_XL_104Hz;
      break;
    case 208:
      regVal |= ODR_XL_208Hz;
      break;
    case 416:
      regVal |= ODR_XL_416Hz;
      break;
    case 833:
      regVal |= ODR_XL_833Hz;
      break;
    case 1660:
      regVal |= ODR_XL_1660Hz;
      break;
    case 3330:
      regVal |= ODR_XL_3330Hz;
      break;
    case 6660:
      regVal |= ODR_XL_6660Hz;
      break;
    default:
      break;
  }

  returnError = writeRegister(CTRL1_XL, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}

// Address: 0x10, bit[7:4]: default value is: 0x00 (Power Down)
// Gets the output data rate of the accelerometer checking if high performance
// mode is enabled in which case the lowest possible data rate is 12.5Hz.
float LSM6DSO::getAccelDataRate(){

  uint8_t regVal;
  uint8_t highPerf;

  status_t returnError = readRegister(&regVal, CTRL1_XL);
  highPerf = getAccelHighPerf();

  if( returnError != IMU_SUCCESS )
    return static_cast<float>( IMU_GENERIC_ERROR );

   regVal &= ~ODR_XL_MASK; 

   switch( regVal ){ 
     case 0:
       return ODR_XL_DISABLE;
     case ODR_XL_1_6Hz: // Can't have 1.6 and high performance mode
       if( highPerf == 0 )
         return 12.5;
       return 1.6;
     case ODR_XL_12_5Hz:
       return 12.5;
     case ODR_XL_26Hz:
       return 26.0;
     case ODR_XL_52Hz:
       return 52.0;
     case ODR_XL_104Hz:
       return 104.0;
     case ODR_XL_208Hz:
       return 208.0;
     case ODR_XL_416Hz:
       return 416.0;
     case ODR_XL_833Hz:
       return 833.0;
     case ODR_XL_1660Hz:
       return 1660.0;
     case ODR_XL_3330Hz:
       return 3330.0;
     case ODR_XL_6660Hz:
       return 6660.0;
      default:
        return static_cast<float>(IMU_GENERIC_ERROR);
   }

}

// Address: 0x15, bit[4]: default value is: 0x00 (Enabled)
// Checks wheter high performance is enabled or disabled. 
uint8_t LSM6DSO::getAccelHighPerf(){

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, CTRL6_C);

  if( returnError != IMU_SUCCESS )
    return IMU_GENERIC_ERROR;
  else
    return ((regVal & 0x10) >> 4); 

}

// Address: 0x17, bit[2]: default value is: 0x00 
// Checks whether the acclerometer is using "old" full scale or "new", see
// datasheet for more information.
uint8_t LSM6DSO::getAccelFullScale(){

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, CTRL8_XL);

  if( returnError != IMU_SUCCESS )
    return IMU_GENERIC_ERROR;
  else
    return ((regVal & 0x02) >> 1); 
}

int16_t LSM6DSO::readRawAccelX() {

	int16_t output;
	status_t errorLevel = readRegisterInt16( &output, OUTX_L_A );
	if( errorLevel != IMU_SUCCESS )
	{
		if( errorLevel == IMU_ALL_ONES_WARNING )
			allOnesCounter++;
		else
			nonSuccessCounter++;
	}
	return output;
}

float LSM6DSO::readFloatAccelX() {
	float output = calcAccel(readRawAccelX());
	return output;
}

int16_t LSM6DSO::readRawAccelY()
{
	int16_t output;
	status_t errorLevel = readRegisterInt16( &output, OUTY_L_A );
	if( errorLevel != IMU_SUCCESS )
	{
		if( errorLevel == IMU_ALL_ONES_WARNING )
			allOnesCounter++;
		else
			nonSuccessCounter++;
	}
	return output;
}

float LSM6DSO::readFloatAccelY()
{
	float output = calcAccel(readRawAccelY());
	return output;
}

int16_t LSM6DSO::readRawAccelZ()
{
	int16_t output;
	status_t errorLevel = readRegisterInt16( &output, OUTZ_L_A );
	if( errorLevel != IMU_SUCCESS )
	{
		if( errorLevel == IMU_ALL_ONES_WARNING )
			allOnesCounter++;
		else
			nonSuccessCounter++;
	}
	return output;
}

float LSM6DSO::readFloatAccelZ()
{
	float output = calcAccel(readRawAccelZ());
	return output;
}

float LSM6DSO::getAccelMultiplier()
{
  uint8_t accelRange; 
  uint8_t scale;
  float output = 0.0f;

  readRegister(&accelRange, CTRL1_XL);
  scale = (accelRange >> 1) & 0x01;
  accelRange = (accelRange >> 2) & (0x03);  
  
  if( scale == 0 ) {
    switch( accelRange ){
      case 0:// Register value 0: 2g
        output =  61;
        break;
      case 1: //Register value 1 : 16g
        output = 488;
        break;
      case 2: //Register value 2 : 4g
        output = 122;
        break;
      case 3://Register value 3: 8g
        output = 244;
        break;
    }
  }

  if( scale == 1 ){
    switch( accelRange ){
      case 0:// Register value 0: 2g
        output =  61;
        break;
      case 1: //Register value 1 : 16g
        output = 488;
        break;
      case 2: //Register value 2 : 4g
        output = 122;
        break;
      case 3://Register value 3: 8g
        output = 244;
        break;
    }
  }

  return output;
}






float LSM6DSO::calcAccel( int16_t input )
{
  uint8_t accelRange; 
  uint8_t scale;
  float output = 0.0f;

  readRegister(&accelRange, CTRL1_XL);
  scale = (accelRange >> 1) & 0x01;
  accelRange = (accelRange >> 2) & (0x03);  
  
  if( scale == 0 ) {
    switch( accelRange ){
      case 0:// Register value 0: 2g
        output = (static_cast<float>(input) * (.061)) / 1000;
        break;
      case 1: //Register value 1 : 16g
        output = (static_cast<float>(input) * (.488)) / 1000;
        break;
      case 2: //Register value 2 : 4g
        output = (static_cast<float>(input) * (.122)) / 1000;
        break;
      case 3://Register value 3: 8g
        output = (static_cast<float>(input) * (.244)) / 1000;
        break;
    }
  }

  if( scale == 1 ){
    switch( accelRange ){
      case 0: //Register value 0: 2g
        output = (static_cast<float>(input) * (0.061)) / 1000;
        break;
      case 1://Register value 1: 2g
        output = (static_cast<float>(input) * (0.061)) / 1000;
        break;
      case 2://Register value 2: 4g
        output = (static_cast<float>(input) * (.122)) / 1000;
        break;
      case 3://Register value 3: 8g
        output = (static_cast<float>(input) * (.244)) / 1000;
        break;
    }
  }

  return output;
}

bool LSM6DSO::getAccelScale() {
  uint8_t accelRange;
  status_t returnError = readRegister(&accelRange, CTRL1_XL);
  if (returnError != IMU_SUCCESS)
    return false;
  accelRange = (accelRange >> 2) & (0x03);
  imuSettings.accelScale = (accelRange >> 1) & 0x01;
  return true;
}



float LSM6DSO::calcAccelFifo(int16_t input) {
    // Lookup-table for factors (µg/LSB)

    static constexpr int32_t FACTORS[2][4] = {
        {61, 488, 122, 244},  // scale=0
        {61,  61, 122, 244}   // scale=1
    };
    
    uint8_t range = imuSettings.accelRange & 0x03; // masking (0-3)
    uint8_t scale = imuSettings.accelScale & 0x01;  // masking (0-1)
    
    // Calculate output using the lookup table
    float output = input * FACTORS[scale][range] ;

//Serial.println("calcAccelFifo: input = " + String(input) + ", scale = " + String(scale) + ", range = " + String(range) + ", factors = " +String(FACTORS[scale][range]) + ", output = "+String(output,6));



    return output; // int16_t * int32_t → int32_t
}



//****************************************************************************//
//
//  Gyroscope section
//
//****************************************************************************//

// Address:CTRL2_G , bit[7:4]: default value is: 0x00.
// Sets the gyro's output data rate thereby enabling it.  
bool LSM6DSO::setGyroDataRate(uint16_t rate) {

  if( (rate < 0) | (rate > 6660) ) 
    return false; 

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, CTRL2_G);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal &= ODR_GYRO_MASK;

  switch( rate ) {
    case 0:
      regVal |= ODR_GYRO_DISABLE;
      break;
    case 125:
      regVal |= ODR_GYRO_12_5Hz;
      break;
    case 26:
      regVal |= ODR_GYRO_26Hz;
      break;
    case 52:
      regVal |= ODR_GYRO_52Hz;
      break;
    case 104:
      regVal |= ODR_GYRO_104Hz;
      break;
    case 208:
      regVal |= ODR_GYRO_208Hz;
      break;
    case 416:
      regVal |= ODR_GYRO_416Hz;
      break;
    case 833:
      regVal |= ODR_GYRO_833Hz;
      break;
    case 1660:
      regVal |= ODR_GYRO_1660Hz;
      break;
    case 3330:
      regVal |= ODR_GYRO_3330Hz;
      break;
    case 6660:
      regVal |= ODR_GYRO_6660Hz;
      break;
    default:
      break;
  }

  returnError = writeRegister(CTRL2_G, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}

// Address:CTRL2_G , bit[7:4]: default value is:0x00 
// Gets the gyro's data rate. A data rate of 0, implies that the gyro portion
// of the IMU is disabled. 
float LSM6DSO::getGyroDataRate(){

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, CTRL2_G);

  if( returnError != IMU_SUCCESS )
    return static_cast<float>(IMU_GENERIC_ERROR);

  regVal &= ~ODR_GYRO_MASK;

  switch( regVal ){
    case ODR_GYRO_DISABLE:
      return 0.0;
    case ODR_GYRO_12_5Hz:
      return 12.5;
    case ODR_GYRO_26Hz:
      return 26.5;
    case ODR_GYRO_52Hz:
      return 52.0;
    case ODR_GYRO_104Hz:
      return 104.0;
    case ODR_GYRO_208Hz:
      return 208.0;
    case ODR_GYRO_416Hz:
      return 416.0;
    case ODR_GYRO_833Hz:
      return 833.0;
    case ODR_GYRO_1660Hz:
      return 1660.0;
    case ODR_GYRO_3330Hz:
      return 3330.0;
    case ODR_GYRO_6660Hz:
      return 6660.0;
    default:
      return static_cast<float>(IMU_GENERIC_ERROR);
  }

}

// Address: 0x11, bit[3:0]: default value is: 0x00
// Sets the gyroscope's range.
bool LSM6DSO::setGyroRange(uint16_t range) {

  if( (range < 125) | (range > 2000))
    return false;

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, CTRL2_G);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal &= FS_G_MASK;

  switch( range ){
    case 125:
      regVal |= FS_G_125dps;
      break;
    case 250:
      regVal |= FS_G_250dps;
      break;
    case 500:
      regVal |= FS_G_500dps;
      break;
    case 1000:
      regVal |= FS_G_1000dps;
      break;
    case 2000:
      regVal |= FS_G_2000dps;
      break;
  }

  returnError = writeRegister(CTRL2_G, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}

// Address: 0x11, bit[3:0]: default value is: 0x00
// Gets the gyroscope's range.
uint16_t LSM6DSO::getGyroRange(){

  uint8_t regVal;

  status_t returnError = readRegister(&regVal, CTRL2_G);
  if( returnError != IMU_SUCCESS )
    return IMU_GENERIC_ERROR;

  regVal &= ~FS_G_MASK;
  
  switch( regVal ){
    case FS_G_125dps:
      return 125;
    case FS_G_250dps:
      return 250;
    case FS_G_500dps:
      return 500;
    case FS_G_1000dps:
      return 1000;
    case FS_G_2000dps:
      return 2000;
    default:
      return IMU_GENERIC_ERROR;
  }
}

int16_t LSM6DSO::readRawGyroX() {

	int16_t output;
	status_t errorLevel = readRegisterInt16( &output, OUTX_L_G );

	if( errorLevel != IMU_SUCCESS ) {
		if( errorLevel == IMU_ALL_ONES_WARNING )
			allOnesCounter++;
		else
			nonSuccessCounter++;
	}

	return output;
}

float LSM6DSO::readFloatGyroX() {

	float output = calcGyro(readRawGyroX());
	return output;
}

int16_t LSM6DSO::readRawGyroY() {

	int16_t output;
	status_t errorLevel = readRegisterInt16( &output, OUTY_L_G );

	if( errorLevel != IMU_SUCCESS ) {
		if( errorLevel == IMU_ALL_ONES_WARNING )
			allOnesCounter++;
		else
			nonSuccessCounter++;
	}

	return output;
}

float LSM6DSO::readFloatGyroY() {
  
	float output = calcGyro(readRawGyroY());
	return output;
}

int16_t LSM6DSO::readRawGyroZ() {

	int16_t output;
	status_t errorLevel = readRegisterInt16( &output, OUTZ_L_G );

	if( errorLevel != IMU_SUCCESS ) {
		if( errorLevel == IMU_ALL_ONES_WARNING )
			allOnesCounter++;
		else
			nonSuccessCounter++;
	}

	return output;
}

float LSM6DSO::readFloatGyroZ() {

	float output = calcGyro(readRawGyroZ());
	return output;

}

float LSM6DSO::calcGyro( int16_t input ) {

  uint8_t gyroRange;  
  uint8_t fullScale;
  float output = 0.0f; 

  readRegister(&gyroRange, CTRL2_G) ;
  fullScale = (gyroRange >> 1) & 0x01; 
  gyroRange = (gyroRange >> 2) & 0x03; 

  if( fullScale )
    output = (static_cast<float>(input) * 4.375)/1000;
  else {
    switch( gyroRange ){
      case 0:
        output = (static_cast<float>(input) * 8.75)/1000;
        break;
      case 1:
        output = (static_cast<float>(input) * 17.50)/1000;
        break;
      case 2:
        output = (static_cast<float>(input) * 35)/1000;
        break;
      case 3:
        output = (static_cast<float>(input) * 70)/1000;
        break;
    }
  }




  return output;
}

//****************************************************************************//
//
//  Temperature section
//
//****************************************************************************//
int16_t LSM6DSO::readRawTemp()
{
	int16_t output;
	readRegisterInt16( &output, OUT_TEMP_L );
	return output;
}  

float LSM6DSO::readTempC()
{
	int16_t temp = (readRawTemp()); 
  int8_t msbTemp = (temp & 0xFF00) >> 8;  
  float tempFloat = static_cast<float>(msbTemp);
  float lsbTemp =  temp & 0x00FF;

  lsbTemp /= 256;
  
  tempFloat += lsbTemp; 
	tempFloat += 25; //Add 25 degrees to remove offset

	return tempFloat;

}

float LSM6DSO::readTempF()
{
	float output = readTempC(); 
	output = (output * 9) / 5 + 32;

	return output;

}

//****************************************************************************//
//
//  FIFO section
//
//****************************************************************************//

void LSM6DSO::fifoBeginSettings() {

	//Split and mask the threshold
	uint8_t thresholdLByte = (imuSettings.fifoThreshold & 0x007F) >> 1;
	uint8_t thresholdHByte = (imuSettings.fifoThreshold & 0x00F0) >> 7;

	//CONFIGURE FIFO_CTRL4
	uint8_t tempFIFO_CTRL4;
  readRegister(&tempFIFO_CTRL4, FIFO_CTRL4);
  // Clear fifoMode bits
  tempFIFO_CTRL4 &= 0xF8;
  // Merge bits
  tempFIFO_CTRL4 |= imuSettings.fifoModeWord;
  if ((imuSettings.gyroFifoEnabled == 1) | (imuSettings.accelFifoEnabled == 1))
  {
    //Decimation is calculated as max rate between accel and gyro
    //Clear decimation bits
    tempFIFO_CTRL4 &= 0x3F; 
    // Merge bits
    tempFIFO_CTRL4 |= (imuSettings.gyroAccelDecimation << 6);
  }

	//Write the data
	writeRegister(FIFO_CTRL1, thresholdLByte);
  uint8_t tempVal;
  tempVal = readRegister(&tempVal, FIFO_CTRL2);
  // Mask threshold bytes
  tempVal &= 0xFE;
  // Merge bytes
  tempVal |= thresholdHByte; 
	writeRegister(FIFO_CTRL2, tempVal);

	writeRegister(FIFO_CTRL4, tempFIFO_CTRL4);

}

// Address:0x0A , bit[2:0]: default value is: 0x00 (disabled).
// Sets the fifo mode. 
bool LSM6DSO::setFifoMode(uint8_t mode) {

  if( (mode < 0) | (mode > 7))
    return false;

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, FIFO_CTRL4);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal &= FIFO_MODE_MASK;
  regVal |= mode; 

  returnError = writeRegister(FIFO_CTRL4, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}

bool LSM6DSO::setTSdecimation(uint8_t mode) {
  // Map mode values to DEC_TS_BATCH bit patterns
  uint8_t dec_ts_batch;
  switch(mode) {
    case 0:  dec_ts_batch = 0; break;  // 00
    case 1:  dec_ts_batch = 1; break;  // 01
    case 8:  dec_ts_batch = 2; break;  // 10
    case 32: dec_ts_batch = 3; break;  // 11
    default: return false;
  }

  uint8_t regVal;
  if(readRegister(&regVal, FIFO_CTRL4) != IMU_SUCCESS) {
    return false;
  }

  // Clear and set DEC_TS_BATCH bits (7-6)
  regVal = (regVal & ~0xC0) | (dec_ts_batch << 6);

  return writeRegister(FIFO_CTRL4, regVal) == IMU_SUCCESS;
}

status_t LSM6DSO::getTSdecimation(uint8_t* factor) {
    uint8_t regVal;
    status_t ret = readRegister(&regVal, FIFO_CTRL4);
    if(ret != IMU_SUCCESS) return ret;
    
    // Extrahiere DEC_TS_BATCH Bits (7-6)
    uint8_t dec = (regVal >> 6) & 0x03;
    
    // Mappe auf die tatsächlichen Faktoren
    switch(dec) {
        case 0: *factor = 0; break;   // Not batched
        case 1: *factor = 1; break;   // Keine Decimation
        case 2: *factor = 8; break;   // Decimation 1/8
        case 3: *factor = 32; break;  // Decimation 1/32
    }
    
    return IMU_SUCCESS;
}


bool LSM6DSO::setTempSamplingRate(uint8_t rate) {
    // Definition der möglichen Raten
    enum TempRates {
        TEMP_DISABLED = 0,  // 00: Not batched in FIFO
        TEMP_1_6HZ    = 1,  // 01: 1.6 Hz
        TEMP_12_5HZ   = 2,  // 10: 12.5 Hz
        TEMP_52HZ     = 3   // 11: 52 Hz
    };

    // Überprüfung auf gültige Rate
    if(rate > TEMP_52HZ) {
        return false;
    }

    uint8_t regVal;
    if(readRegister(&regVal, FIFO_CTRL4) != IMU_SUCCESS) {
        return false;
    }

    // Clear ODR_T_BATCH bits (5-4)
    regVal &= ~0x30;

    // Set new ODR_T_BATCH value
    regVal |= (rate << 4);

    return writeRegister(FIFO_CTRL4, regVal) == IMU_SUCCESS;
}

// Address:0x0A , bit[2:0]: default value is: 0x00 (disabled).
// Gets the fifo mode. 
uint8_t LSM6DSO::getFifoMode(){

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, FIFO_CTRL4);
  if( returnError != IMU_SUCCESS )
    return returnError;
  else
    return (regVal & ~FIFO_MODE_MASK); 
}

// Address:0x07 and 0x08 , bit[7:0] bit[0]: default value is: 0x000
// This sets the number of bytes that the FIFO can hold. Maximum possible value
// is 511
bool LSM6DSO::setFifoDepth(uint16_t depth) {

  if( (depth < 0) | (depth > 511) )
    return false;

  uint8_t dataToWrite[2];
  uint8_t regVal;
  status_t returnError = readRegister(&regVal, FIFO_CTRL2);

  regVal &= 0x01; 
  dataToWrite[0] = depth & 0x00FF; // full byte
  dataToWrite[1] = (depth & 0x0100) >> 8; //one bit
  dataToWrite[1] |= regVal;// add the contents from the read 

    
  returnError = writeMultipleRegisters(dataToWrite, FIFO_CTRL1, 2);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}

// Address:0x07 and 0x08 , bit[7:0] bit[0]: default value is: 0x000
// This function gets the number of bytes that the FIFO can hold.  
uint16_t LSM6DSO::getFifoDepth(){

  uint8_t regVal[2];
  uint16_t waterMark;
  status_t returnError = readMultipleRegisters(regVal, FIFO_CTRL1, 2);
  if( returnError != IMU_SUCCESS )
    return IMU_GENERIC_ERROR;
  
  waterMark = static_cast<uint16_t>(regVal[1]) << 8 | regVal[0];
  return waterMark; 
}

// Address: 0x07 , bit[3:0]: default value is: 0x00
// Sets the accelerometer's batch data rate for the FIFO. 
bool LSM6DSO::setAccelBatchDataRate(uint16_t rate) {

  if( (rate < 0) | (rate > 6660) )
    return false;

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, FIFO_CTRL3);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal &= FIFO_BDR_ACC_MASK;

  switch( rate ){
    case 0:
      regVal |= FIFO_BDR_ACC_NOT_BATCHED;
      break;
    case 16:
      regVal |= FIFO_BDR_ACC_1_6Hz;
      break;
    case 125:
      regVal |= FIFO_BDR_ACC_12_5Hz;
      break;
    case 52:
      regVal |= FIFO_BDR_ACC_52Hz;
      break;
    case 104:
      regVal |= FIFO_BDR_ACC_104Hz;
      break;
    case 208:
      regVal |= FIFO_BDR_ACC_208Hz;
      break;
    case 417:
      regVal |= FIFO_BDR_ACC_417Hz;
      break;
    case 833:
      regVal |= FIFO_BDR_ACC_833Hz;
      break;
    case 1660:
      regVal |= FIFO_BDR_ACC_1667Hz;
      break;
    case 3330:
      regVal |= FIFO_BDR_ACC_3333Hz;
      break;
    case 6660:
      regVal |= FIFO_BDR_ACC_6667Hz;
      break;
    default:
      break;
  }

  returnError = writeRegister(FIFO_CTRL3, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}

// Address: 0x07 , bit[3:0]: default value is: 0x00
// Gets the accelerometer's batch data rate for the FIFO. 
float LSM6DSO::getAccelBatchDataRate() {

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, FIFO_CTRL3);
  if( returnError != IMU_SUCCESS )
      return static_cast<float>(IMU_GENERIC_ERROR);

  regVal &= ~FIFO_BDR_ACC_MASK;

  switch( regVal ){
    case FIFO_BDR_ACC_NOT_BATCHED:
      return 0.0;
    case FIFO_BDR_ACC_1_6Hz:
      return 1.6;
    case FIFO_BDR_ACC_12_5Hz:
      return 12.5;
    case FIFO_BDR_ACC_52Hz:
      return 52.0;
    case FIFO_BDR_ACC_104Hz:
      return 104.0;
    case FIFO_BDR_ACC_208Hz:
      return 208.0;
    case FIFO_BDR_ACC_417Hz:
      return 417.0;
    case FIFO_BDR_ACC_833Hz:
      return 833.0;
    case FIFO_BDR_ACC_1667Hz:
      return 1660.0;
    case FIFO_BDR_ACC_3333Hz:
      return 3330.0;
    case FIFO_BDR_ACC_6667Hz:
      return 6660.0;
    default:
      return static_cast<float>(IMU_GENERIC_ERROR);
  }

}

// Address: 0x07 , bit[7:4]: default value is: 0x00
// Sets the gyroscope's batch data rate for the FIFO. 
bool LSM6DSO::setGyroBatchDataRate(uint16_t rate) {

  if( (rate < 0) | (rate > 6667) )
    return false; 
  
  uint8_t regVal;
  status_t returnError = readRegister(&regVal, FIFO_CTRL3);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal &= FIFO_BDR_GYRO_MASK;

  switch( rate ){
    case 0:
      regVal |= FIFO_BDR_GYRO_NOT_BATCHED;
      break;
    case 65:
      regVal |= FIFO_BDR_GYRO_6_5Hz;
      break;
    case 125:
      regVal |= FIFO_BDR_GYRO_12_5Hz;
      break;
    case 52:
      regVal |= FIFO_BDR_GYRO_52Hz;
      break;
    case 104:
      regVal |= FIFO_BDR_GYRO_104Hz;
      break;
    case 208:
      regVal |= FIFO_BDR_GYRO_208Hz;
      break;
    case 417:
      regVal |= FIFO_BDR_GYRO_417Hz;
      break;
    case 833:
      regVal |= FIFO_BDR_GYRO_833Hz;
      break;
    case 1660:
      regVal |= FIFO_BDR_GYRO_1667Hz;
      break;
    case 3330:
      regVal |= FIFO_BDR_GYRO_3333Hz;
      break;
    case 6660:
      regVal |= FIFO_BDR_GYRO_6667Hz;
      break;
    default:
      break;
  }

  returnError = writeRegister(FIFO_CTRL3, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}

// Address: 0x07 , bit[7:4]: default value is: 0x00
// Gets the gyroscope's batch data rate for the FIFO. 
float LSM6DSO::getGyroBatchDataRate() {

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, FIFO_CTRL3);
  if( returnError != IMU_SUCCESS )
      return static_cast<float>(IMU_GENERIC_ERROR);

  regVal &= ~FIFO_BDR_GYRO_MASK;

  switch( regVal ){
    case FIFO_BDR_GYRO_NOT_BATCHED:
      return 0.0;
    case FIFO_BDR_GYRO_6_5Hz:
      return 6.5;
    case FIFO_BDR_GYRO_12_5Hz:
      return 12.5;
    case FIFO_BDR_GYRO_52Hz:
      return 52.0;
    case FIFO_BDR_GYRO_104Hz:
      return 104.0;
    case FIFO_BDR_GYRO_208Hz:
      return 208.0;
    case FIFO_BDR_GYRO_417Hz:
      return 417.0;
    case FIFO_BDR_GYRO_833Hz:
      return 833.0;
    case FIFO_BDR_GYRO_1667Hz:
      return 1660.0;
    case FIFO_BDR_GYRO_3333Hz:
      return 3330.0;
    case FIFO_BDR_GYRO_6667Hz:
      return 6660.0;
    default:
      return static_cast<float>(IMU_GENERIC_ERROR);
  }

}

void LSM6DSO::fifoClear() {
	//Drain the fifo data and dump it

}

fifoData LSM6DSO::fifoRead() {
	//Pull the last data from the fifo
  uint8_t tempTagByte; 
  int16_t tempData;  
  fifoData tempFifoData; 
  
  status_t returnError = readRegister(&tempTagByte, FIFO_DATA_OUT_TAG);
  tempTagByte &= 0xF8;
  tempTagByte = tempTagByte >> 3;

  if( returnError != IMU_SUCCESS ){
    tempFifoData.fifoTag = IMU_GENERIC_ERROR;  
    return tempFifoData;  
  }


    int16_t tempData1; 
    int16_t tempData2; 
    int16_t tempData3;
    int16_t tempData4; 
    int16_t tempData5; 
    int16_t tempData6;
    
    readRegisterInt16(&tempData1, FIFO_DATA_OUT_X_L);
    readRegisterInt16(&tempData2, FIFO_DATA_OUT_Y_L);
    readRegisterInt16(&tempData3, FIFO_DATA_OUT_Z_L);
    readRegisterInt16(&tempData4, FIFO_DATA_OUT_X_H);
    readRegisterInt16(&tempData5, FIFO_DATA_OUT_Y_H);
    readRegisterInt16(&tempData6, FIFO_DATA_OUT_Z_H);


  tempFifoData.fifoTag = tempTagByte;

  if( (tempTagByte == ACCELEROMETER_DATA) || 
      (tempTagByte == ACCELERTOMETER_DATA_T_1) || 
      (tempTagByte == ACCELERTOMETER_DATA_T_2) || 
      (tempTagByte == ACCELERTOMETER_DATA_2xC) || 
      (tempTagByte == ACCELERTOMETER_DATA_3xC) ) {

    readRegisterInt16(&tempData, FIFO_DATA_OUT_X_L);
    tempFifoData.xAccel = calcAccel(tempData);
    readRegisterInt16(&tempData, FIFO_DATA_OUT_Y_L);
    tempFifoData.yAccel = calcAccel(tempData); 
    readRegisterInt16(&tempData, FIFO_DATA_OUT_Z_L);
    tempFifoData.zAccel = calcAccel(tempData);
  }


  if (((tempTagByte == GYROSCOPE_DATA) || 
       (tempTagByte == GYRO_DATA_T_1) || 
       (tempTagByte == GYRO_DATA_T_2) || 
       (tempTagByte == GYRO_DATA_2xC) || 
       (tempTagByte == GYRO_DATA_3xC))) {

    readRegisterInt16(&tempData, FIFO_DATA_OUT_X_L);
    tempFifoData.xGyro = calcGyro(tempData);
    readRegisterInt16(&tempData, FIFO_DATA_OUT_Y_L);
    tempFifoData.yGyro = calcGyro(tempData); 
    readRegisterInt16(&tempData, FIFO_DATA_OUT_Z_L);
    tempFifoData.zGyro = calcGyro(tempData);
  }




  if( tempTagByte == TEMPERATURE_DATA ){ 
    readRegisterInt16(&tempData, FIFO_DATA_OUT_X_L);
    tempFifoData.temperatureC = tempData;
  }


  if( tempTagByte == TIMESTAMP_DATA) {


  }

  return tempFifoData;
  
}


uint16_t LSM6DSO::decodeFifoSamples(const uint8_t* buffer, uint16_t len, std::function<void(const FifoSample&)> cb) {
    uint16_t samplesParsed = 0;
    float currentTimestamp = 0.0f; // optional: letzten Timestamp merken

    for (uint16_t offset = 0; offset + 6 < len; offset += 7) {
        FifoSample sample = {};
        uint8_t datatype = (buffer[offset] >> 3) & 0x1F;
        sample.id = datatype;

        if(datatype == ACCELEROMETER_DATA) {
            sample.timestamp = currentTimestamp;
            sample.value1 = calcAccelFifo((int16_t)(buffer[offset+1] | (buffer[offset+2] << 8))) ;
            sample.value2 = calcAccelFifo((int16_t)(buffer[offset+3] | (buffer[offset+4] << 8))) ;
            sample.value3 = calcAccelFifo((int16_t)(buffer[offset+5] | (buffer[offset+6] << 8))) ;
        }
        else if(datatype == GYROSCOPE_DATA) {
            sample.timestamp = currentTimestamp;
            sample.value1 = calcGyro((int16_t)(buffer[offset+1] | (buffer[offset+2] << 8)));
            sample.value2 = calcGyro((int16_t)(buffer[offset+3] | (buffer[offset+4] << 8)));
            sample.value3 = calcGyro((int16_t)(buffer[offset+5] | (buffer[offset+6] << 8)));
        }
        else if(datatype == TEMPERATURE_DATA) {
            sample.value1 = (int16_t)(buffer[offset+1] | (buffer[offset+2] << 8));
        }
        else if(datatype == TIMESTAMP_DATA) {
            uint32_t timestamp = ((uint32_t)buffer[offset+4] << 24) |
                                 ((uint32_t)buffer[offset+3] << 16) |
                                 ((uint32_t)buffer[offset+2] << 8) |
                                 (uint32_t)buffer[offset+1];
            currentTimestamp = timestamp ;
            sample.timestamp = currentTimestamp;
        }
        // ... ggf. mehr Tagtypen einbauen (s.u.)

        // Callback für jedes Sample (macht <=> ringBuffer[writeIdx]=sample etc.)
        cb(sample);
        samplesParsed++;
    }
    return samplesParsed;
}

FifoSample LSM6DSO::decodeFifoSample(const uint8_t* fifo_data) {
    FifoSample sample = {};
    uint8_t datatype = (fifo_data[0] >> 3) & 0x1F;
    sample.id = datatype;

    if (datatype == ACCELEROMETER_DATA) {
        sample.value1 = calcAccelFifo((int16_t)(fifo_data[1] | (fifo_data[2] << 8))) ;
        sample.value2 = calcAccelFifo((int16_t)(fifo_data[3] | (fifo_data[4] << 8))) ;
        sample.value3 = calcAccelFifo((int16_t)(fifo_data[5] | (fifo_data[6] << 8))) ;
    } else if (datatype == GYROSCOPE_DATA) {
        sample.value1 = calcGyro((int16_t)(fifo_data[1] | (fifo_data[2] << 8)));
        sample.value2 = calcGyro((int16_t)(fifo_data[3] | (fifo_data[4] << 8)));
        sample.value3 = calcGyro((int16_t)(fifo_data[5] | (fifo_data[6] << 8)));
    } else if (datatype == TEMPERATURE_DATA) {
                    // Temperaturdaten gemäß Tabelle 81 aus FIFO_DATA_OUT_X_L und FIFO_DATA_OUT_X_H
            int16_t rawTemp = (int16_t)(fifo_data[1] | (fifo_data[2] << 8));
            
            // Berechnung wie in readTempC() aber mit FIFO-Datenformat
            int8_t msbTemp = (rawTemp & 0xFF00) >> 8;
            float tempFloat = static_cast<float>(msbTemp);
            float lsbTemp = rawTemp & 0x00FF;
            
            lsbTemp /= 256.0f;
            tempFloat += lsbTemp;
            tempFloat += 25.0f; // Offset-Korrektur
            
            sample.value1 = tempFloat; // Temperatur in °C
            sample.value2 = 0.0f;      // Nicht verwendet
            sample.value3 = 0.0f;      // Nicht verwendet      
    }
    // ... weitere Typen nach Wunsch
    return sample;
}


/// @brief 
/// @return 
FifoSample LSM6DSO::fifoRead2() {
    uint8_t fifo_data[7]; // RAW FIFO DATA (TAG + 6 Bytes)
    status_t returnError = readMultipleRegisters(fifo_data, FIFO_DATA_OUT_TAG, 7);
    FifoSample tempFifoData ={} ; // Ensure zero-initialized

    // TYP BESTIMMEN
  uint8_t tempTagByte = fifo_data[0];  // Bits 7-3 als 5-Bit Wert
  tempTagByte &= 0xF8;
  tempTagByte = tempTagByte >> 3;
//Serial.println("FIFO READ TAG: " + String(tempTagByte));
    uint8_t datatype = (fifo_data[0] >> 3) & 0x1F; // Bits 7-3 als 5-Bit Wert


//Serial.println("FIFO READ DATA: " +String(fifo_data[0]) + "     Type "  + String(datatype) + "   " + String(fifo_data[1]) + "   " + String(fifo_data[2]) + "   " +String(fifo_data[3]) + "   " +String(fifo_data[4]) + "   " +String(fifo_data[5]) + "   " +String(fifo_data[6]));

    // ACCELEROMETER DATA
    if(datatype == ACCELEROMETER_DATA || 
       datatype == ACCELERTOMETER_DATA_T_1 || 
       datatype == ACCELERTOMETER_DATA_T_2 || 
       datatype == ACCELERTOMETER_DATA_2xC || 
       datatype == ACCELERTOMETER_DATA_3xC) {
        
        tempFifoData.id = datatype;      
        tempFifoData.value1 = calcAccelFifo((int16_t)(fifo_data[1] | (fifo_data[2] << 8)))*1000;
        tempFifoData.value2 = calcAccelFifo((int16_t)(fifo_data[3] | (fifo_data[4] << 8)))*1000;
        tempFifoData.value3 = calcAccelFifo((int16_t)(fifo_data[5] | (fifo_data[6] << 8)))*1000;

//Serial.println("TEMPFIFO DATA1 "+String(tempFifoData.value1,6)+ " Data2 "+ String(tempFifoData.value2,6) + " Data3 "+ String(tempFifoData.value3,6));

        //float data1 = calcAccelFifo((int16_t)(fifo_data[1] | (fifo_data[2] << 8)))*1000;
        //float data2 = calcAccelFifo((int16_t)(fifo_data[3] | (fifo_data[4] << 8)))*1000;
        //float data3 = calcAccelFifo((int16_t)(fifo_data[5] | (fifo_data[6] << 8)))*1000;

        //Serial.println("FLOATDATA1 "+String(data1,6)+ " Data2 "+ String(data2,6) + " Data3 "+ String(data3,6));
        
    }
    // GYROSCOPE DATA
    else if(datatype == GYROSCOPE_DATA || 
            datatype == GYRO_DATA_T_1 || 
            datatype == GYRO_DATA_T_2 || 
            datatype == GYRO_DATA_2xC ||         
            datatype == GYRO_DATA_3xC) {
        
        tempFifoData.id = datatype;
        
        tempFifoData.value1 = calcGyro((int16_t)(fifo_data[1] | (fifo_data[2] << 8)));
        tempFifoData.value2= calcGyro((int16_t)(fifo_data[3] | (fifo_data[4] << 8)));    
        tempFifoData.value3 = calcGyro((int16_t)(fifo_data[5] | (fifo_data[6] << 8)));  
    } 
    // TEMPERATURE DATA
    else if(datatype == TEMPERATURE_DATA) {
        tempFifoData.id = datatype;       
        tempFifoData.value1 = (int16_t)(fifo_data[1] | (fifo_data[2] << 8));
    }      
    // TIMESTAMP DATA
    else if(datatype == TIMESTAMP_DATA) {   
        tempFifoData.id = datatype;
        
        // Korrekte Extraktion der 4 Bytes (Little-Endian)
        uint32_t timestamp = ((uint32_t)fifo_data[4] << 24) |
                            ((uint32_t)fifo_data[3] << 16) |
                            ((uint32_t)fifo_data[2] << 8)  |
                            (uint32_t)fifo_data[1];
        
        // Umrechnung in Sekunden (25µs pro Tick)
        tempFifoData.timestamp = timestamp * imuSettings.LSBSTEP*1000000;
    }



/*     if(returnError != IMU_SUCCESS) {
        tempFifoData.id= IMU_GENERIC_ERROR;
        return tempFifoData;
    } */
    //Serial.println("FIFO DATA: " + String(tempFifoData.value1) + "   " + String(tempFifoData.value2) + "   " +String(tempFifoData.value3));
    return tempFifoData;
}





uint16_t LSM6DSO::getFifoStatus2() {

uint8_t fist1;
uint8_t fist2;


uint8_t fifo_status1 = readRegister(&fist1, FIFO_STATUS1);
uint8_t fifo_status2 = readRegister(&fist2, FIFO_STATUS2);
uint16_t diff_fifo = ((fifo_status2 & 0x03) << 8) | fifo_status1;  // DIFF_FIFO[9:0]

return diff_fifo;  

}






uint16_t LSM6DSO::getFifoStatus() {

	uint8_t regVal;
	int16_t numBytes;

	readRegisterInt16(&numBytes, FIFO_STATUS1);
	numBytes &= 0x03FF;

	return numBytes;  

}

void LSM6DSO::fifoEnd() {
	// turn off the fifo
	writeRegister(FIFO_STATUS1, 0x00);  //Disable
}

// Address: 0x04 , bit[3]: default value is: 0x00 (disabled)
// Enables the pedometer functionality of the IMU. 
bool LSM6DSO::enablePedometer(bool enable) {

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, EMB_FUNC_EN_A);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal &= PEDO_MASK; 
  regVal |= enable; 

  returnError = writeRegister(EMB_FUNC_EN_A, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}

// Address: 0x04 , bit[3]: default value is: 0x00
// Checks the state of the pedometer.
uint8_t LSM6DSO::getPedometer() {

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, EMB_FUNC_EN_A);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal &= ~PEDO_MASK; 
  if( regVal == PEDO_ENABLED )
    return true; 
  else
    return false;
}

// Address: 0x62 and 0x63 , bit[7:0]
// Gets the amount of steps taken.
uint8_t LSM6DSO::getSteps(){

  int16_t steps;
  status_t returnError = readRegisterInt16(&steps, STEP_COUNTER_L);
  if( returnError != IMU_SUCCESS )
    return returnError;
  else
    return steps;
  
}

// Address:0x64 , bit[8]: default value is: 0x00 
// Resets the number of steps held in the STEP COUNTER registers.
bool LSM6DSO::resetSteps() {

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, EMB_FUNC_SRC);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal |= PEDO_RST_STEP_ENABLED;

  returnError = writeRegister(EMB_FUNC_SRC, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}

// Address: 0x56 and 0x58, bit[3:1] and bit[7]: default value is: 0x00
// Enables the single tap interrupts, as well as the direction that initiates
// the interrupt: X, Y, Z, or some combination of all three.  
bool LSM6DSO::enableTap(bool enable, bool xEnable, bool yEnable, bool zEnable) {

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, TAP_CFG2);
  if( returnError != IMU_SUCCESS )
      return false;
  
  regVal &= INTERRUPTS_MASK; 
  if( enable )
    regVal |= INTERRUPTS_ENABLED;
  else
    regVal |= INTERRUPTS_DISABLED;

  returnError = writeRegister(regVal, TAP_CFG2);
  if( returnError != IMU_SUCCESS )
      return false;

  returnError = readRegister(&regVal, TAP_CFG0);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal &= TAP_INTERRUPT_MASK;

  if( xEnable )
    regVal |= TAP_X_EN_ENABLED; 
  else
    regVal |= TAP_X_EN_DISABLED; 

  if( yEnable )
    regVal |= TAP_Y_EN_ENABLED; 
  else
    regVal |= TAP_X_EN_DISABLED; 

  if( zEnable )
    regVal |= TAP_Z_EN_ENABLED; 
  else
    regVal |= TAP_X_EN_DISABLED; 

  returnError = writeRegister(TAP_CFG0, regVal);
  if( returnError != IMU_SUCCESS )
    return false;
  else
    return true;
}

// Address: 0x57, bit[7:5]: default value is: 0x00
// Sets the direction priority for tap detection e.g. an X direction tap is
// prioritized over a Y-direction tap etc. 
bool LSM6DSO::setTapDirPrior(uint8_t prior) {
  
  if (prior > 0x08)
    return false;

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, TAP_CFG1);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal &= TAP_PRIORITY_MASK;

  switch( prior ){
    case TAP_PRIORITY_XYZ:
      regVal |= TAP_PRIORITY_XYZ;
      break;
    case TAP_PRIORITY_YXZ:
      regVal |= TAP_PRIORITY_YXZ;
      break;
    case TAP_PRIORITY_XZY:
      regVal |= TAP_PRIORITY_XZY;
      break;
    case TAP_PRIORITY_ZYX:
      regVal |= TAP_PRIORITY_ZYX;
      break;
    case TAP_PRIORITY_YZX:
      regVal |= TAP_PRIORITY_YZX;
      break;
    case TAP_PRIORITY_ZXY:
      regVal |= TAP_PRIORITY_ZXY;
      break;
    default:
      break;
  }

  returnError = writeRegister(TAP_CFG1, regVal);
  if( returnError != IMU_SUCCESS )
    return false;
  else
    return true;
}

// Address: 0x57, bit[7:5]: default value is: 0x00
// Sets the direction priority for tap detection e.g. an X direction tap is
// prioritized over a Y-direction tap etc. 
uint8_t LSM6DSO::getTapDirPrior(){

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, TAP_CFG2);
  if( returnError != IMU_SUCCESS )
    return IMU_GENERIC_ERROR;
  else
    return (regVal & ~TAP_PRIORITY_MASK); 
}

// Address: 0x56, bit[7,0]: default value is: 0x00 
// Sets the configuration that clears the tap interrupt upon reading the
// interrupt. 
bool LSM6DSO::setTapClearOnRead(bool enable) {

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, TAP_CFG0);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal &= 0x7E;

  if( enable ) { 
    regVal |= LIR_ENABLED;
    regVal |= INT_CLR_ON_READ_IMMEDIATE;
  }

  regVal |= 0x08; // remove- brute force

  returnError = writeRegister(TAP_CFG0, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
    return true;

}

// Address: 0x56, bit[7,0]: default value is: 0x00
// Gets the configuration that clears the tap interrupt upon reading the
// interrupt. 
uint8_t LSM6DSO::getTapClearOnRead() {

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, TAP_CFG0);
  if( returnError != IMU_SUCCESS )
      return IMU_GENERIC_ERROR;
  else
    return regVal &= ~0x7E;

}

// Address:0x64 , bit[6]: default value is: 0x00
// Checks if a step has been detected.
bool LSM6DSO::listenStep() {

  uint8_t regVal;
  readRegister(&regVal, EMB_FUNC_SRC);
  regVal &= ~STEP_DETECED_MASK;

  if( regVal )
      return true;
  else
      return false;
}

// Address: 0x5E , bit[7:0]: default value is: 0x00
// Routes the given interrupt to hardware pin one. 
bool LSM6DSO::routeHardInterOne(uint8_t interrupt) {

  if (interrupt > 0x80)
    return false; 

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, MD1_CFG);

  regVal &= ~interrupt; //Preserve all but the one to set
  regVal |= interrupt; 
  regVal = INT1_SINGLE_TAP_ENABLED;// remove

  returnError = writeRegister(MD1_CFG, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}

// Address: 0x5F , bit[7:0]: default value is: 0x00
// Routes the given interrupt to hardware pin two. 
bool LSM6DSO::routeHardInterTwo(uint8_t interrupt) {

  if( (interrupt < 0) | (interrupt > 0x80) )
    return false; 

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, MD2_CFG);

  regVal &= ~interrupt; //Preserve all but the one to set
  regVal |= interrupt; 

  returnError = writeRegister(MD2_CFG, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}

// Address: 0x12 , bit[4]: default value is: 0x01
// Sets register iteration when making multiple reads.
bool LSM6DSO::setIncrement(bool enable) {

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, CTRL3_C);
  if( returnError != IMU_SUCCESS )
      return false;

  regVal &= 0xFD;
  regVal |= IF_INC_ENABLED;

  returnError = writeRegister(CTRL3_C, regVal);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}

bool LSM6DSO::softwareReset(){

  status_t returnError = writeRegister(SW_RESET_DEVICE, CTRL3_C);
  if( returnError != IMU_SUCCESS )
    return false;
  else
    return true; 
}

// Address:0x1A , bit[7:0]: default value is: 0x00
// This function clears the given interrupt upon reading it from the register.  
uint8_t LSM6DSO::clearAllInt() {

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, ALL_INT_SRC);
  if( returnError != IMU_SUCCESS )
      return returnError;
  else
      return regVal;
}

// Address:0x1C , bit[7:0]: default value is: 0x00
// This function clears the given interrupt upon reading it from the register.  
uint8_t LSM6DSO::clearTapInt() {

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, TAP_SRC);
  if( returnError != IMU_SUCCESS )
      return returnError;
  else
      return regVal;
}

// Address: 0x57, bit[4:0]: default value is: 0x00
// Sets the threshold for x-axis tap recognintion.
bool LSM6DSO::setXThreshold(uint8_t thresh) {

  if (thresh > 31)
    return false;

  uint8_t regVal;
  status_t returnError = readRegister(&regVal, TAP_CFG1);
  regVal &= 0xE0;

  regVal |= thresh;
  returnError = writeRegister(TAP_CFG1, thresh);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;
}




// Address: 0x5A, bit[7:0]: default value is: 0x00
// Sets the various tap configurations. This is a broad function that just
// writes the entier register. 
bool LSM6DSO::configureTap(uint8_t settings) {

  uint8_t regVal;

  status_t returnError =  writeRegister(INT_DUR2, settings);
  if( returnError != IMU_SUCCESS )
      return false;
  else
      return true;     
}


float LSM6DSO::getLSBSTEP() {
  // This function sets the LSBSTEP value based on the internal frequency fine
  uint8_t frq;
  readRegister(&frq, INTERNAL_FREQ_FINE);

  float lsbstep = (1.0 / 40000.0) * (1.0 + 0.0015 * frq)* 1000000.0f  ; // LSBSTEP = 1 / (40kHz * (1 + 0.0015 * frq)) * 1,000,000 ;

  status_t returnError = readRegister(&frq, INTERNAL_FREQ_FINE);
  if( returnError != IMU_SUCCESS )
      return 25;
  else
      return lsbstep;

}


