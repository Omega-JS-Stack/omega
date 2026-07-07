/**
 * Adblock Detector
 * This script is used to detect if the user is using an adblocker.
**/

// Create the detector element
var $detector = document.createElement('div');

// Set the ID and hide it
$detector.id = 'uj-antivert-detector';
$detector.style.display = 'none';

// Append the element to the body
document.body.appendChild($detector);
