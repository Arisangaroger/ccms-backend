const Complaint = require('../models/Complaint');
const User = require('../models/User');
const DistrictDepartment = require('../models/DistrictDepartment');
const ForwardingRecord = require('../models/ForwardingRecord');
const { validationResult } = require('express-validator');
const { sendNotification } = require('../utils/notificationService');

// Helper function to find appropriate institution
const findAppropriateInstitution = async (category, province, district) => {
  try {
    // Find institution in the same district and province that handles this category
    const institution = await User.findOne({
      role: 'institution',
      province,
      district,
      // You might want to add a categories field to the User model for institutions
      // and check if they handle this category
    });

    if (institution) {
      return institution;
    }

    // If no institution found in district, find one in the province
    const provinceInstitution = await User.findOne({
      role: 'institution',
      province,
    });

    return provinceInstitution;
  } catch (error) {
    console.error('Error finding institution:', error);
    return null;
  }
};

// Calculate resolution deadline based on category
const calculateResolutionDeadline = (category) => {
  const date = new Date();
  switch (category) {
    case 'WATER':
    case 'ELECTRICITY':
      // 3 days for urgent services
      date.setDate(date.getDate() + 3);
      break;
    case 'PUBLIC_SAFETY':
      // 2 days for safety issues
      date.setDate(date.getDate() + 2);
      break;
    case 'ROADS':
    case 'SANITATION':
      // 7 days for infrastructure
      date.setDate(date.getDate() + 7);
      break;
    default:
      // 14 days for other categories
      date.setDate(date.getDate() + 14);
  }
  return date;
};

// Submit new complaint
exports.submitComplaint = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title,
      description,
      category,
      province,
      district
    } = req.body;

    // Ensure the user is a citizen
    if (req.user.role !== 'citizen') {
      return res.status(403).json({
        message: 'Only citizens can submit complaints'
      });
    }

    // Find appropriate institution
    const institution = await findAppropriateInstitution(category, province, district);
    
    if (!institution) {
      return res.status(404).json({
        message: 'No appropriate institution found to handle this complaint'
      });
    }

    // Calculate resolution deadline
    const resolutionDeadline = calculateResolutionDeadline(category);

    // Create new complaint
    const complaint = new Complaint({
      title,
      description,
      category,
      province,
      district,
      citizenId: req.user._id,
      institutionId: institution._id,
      resolutionDeadline,
      assignedDepartment: institution._id // Initially same as institutionId
    });

    await complaint.save();
    await complaint.populate('institutionId', 'institutionName');
    
    // Send notification to citizen
    let notificationError = null;
    try {
      await sendNotification('SUBMITTED', {
        email: req.user.email,
        phone: req.user.phone
      }, {
        complaintId: complaint._id,
        trackingNumber: complaint.trackingNumber
      });
    } catch (error) {
      console.error('Notification error:', error);
      notificationError = error;
    }

    res.status(201).json({
      message: 'Complaint submitted successfully',
      complaint: {
        ...complaint.toObject(),
        trackingNumber: complaint.trackingNumber,
        assignedTo: complaint.institutionId.institutionName
      },
      notificationSent: !notificationError,
      notificationError: notificationError?.message
    });

  } catch (error) {
    console.error('Error submitting complaint:', error);
    res.status(500).json({
      message: 'Error submitting complaint',
      error: error.message
    });
  }
};

// Get complaint by tracking number
exports.getComplaintByTracking = async (req, res) => {
  try {
    const { trackingNumber } = req.params;

    const complaint = await Complaint.findOne({ trackingNumber })
      .populate('citizenId', 'fullName')
      .populate('institutionId', 'institutionName')
      .populate('assignedDepartment', 'institutionName');

    if (!complaint) {
      return res.status(404).json({
        message: 'Complaint not found'
      });
    }

    res.json(complaint);
  } catch (error) {
    console.error('Error fetching complaint:', error);
    res.status(500).json({
      message: 'Error fetching complaint',
      error: error.message
    });
  }
};

// Get complaints for logged-in user (citizen or institution)
exports.getMyComplaints = async (req, res) => {
  try {
    let query = {};
    
    if (req.user.role === 'citizen') {
      query.citizenId = req.user._id;
    } else if (req.user.role === 'institution') {
      query.institutionId = req.user._id;
    } else {
      return res.status(403).json({
        message: 'Unauthorized access'
      });
    }

    const complaints = await Complaint.find(query)
      .populate('citizenId', 'fullName')
      .populate('institutionId', 'institutionName')
      .populate('assignedDepartment', 'institutionName')
      .sort({ submissionDate: -1 });

    res.json(complaints);
  } catch (error) {
    console.error('Error fetching complaints:', error);
    res.status(500).json({
      message: 'Error fetching complaints',
      error: error.message
    });
  }
};

// Get institution complaints with filters and sorting
exports.getInstitutionComplaints = async (req, res) => {
  try {
    // Ensure user is an institution
    if (req.user.role !== 'institution') {
      return res.status(403).json({
        message: 'Access denied. Only institutions can view these complaints'
      });
    }

    const {
      status,
      deadlineApproaching,
      sortBy = 'deadline' // default sort by deadline
    } = req.query;

    // Base query: get complaints assigned to this institution
    let query = {
      institutionId: req.user._id
    };

    // Add status filter if provided
    if (status === 'unresolved') {
      query.status = { $ne: 'RESOLVED' };
    }

    // Add deadline approaching filter (within next 2 days)
    if (deadlineApproaching === 'true') {
      const twoDaysFromNow = new Date();
      twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
      
      query.resolutionDeadline = {
        $lte: twoDaysFromNow,
        $gte: new Date()
      };
      query.status = { $ne: 'RESOLVED' };
    }

    // Create the base query
    let complaintsQuery = Complaint.find(query)
      .populate('citizenId', 'fullName phone email')
      .populate('institutionId', 'institutionName');

    // Apply sorting
    switch (sortBy) {
      case 'deadline':
        complaintsQuery = complaintsQuery.sort({ resolutionDeadline: 1 }); // Ascending (soonest first)
        break;
      case 'oldest':
        complaintsQuery = complaintsQuery.sort({ submissionDate: 1 }); // Ascending (oldest first)
        break;
      case 'newest':
        complaintsQuery = complaintsQuery.sort({ submissionDate: -1 }); // Descending (newest first)
        break;
      default:
        complaintsQuery = complaintsQuery.sort({ resolutionDeadline: 1 });
    }

    const complaints = await complaintsQuery.exec();

    // Add urgency flag for complaints approaching deadline
    const complaintsWithUrgency = complaints.map(complaint => {
      const complaintObj = complaint.toObject();
      if (complaint.resolutionDeadline) {
        const daysUntilDeadline = Math.ceil(
          (complaint.resolutionDeadline - new Date()) / (1000 * 60 * 60 * 24)
        );
        complaintObj.isUrgent = daysUntilDeadline <= 2 && complaint.status !== 'RESOLVED';
        complaintObj.daysUntilDeadline = daysUntilDeadline;
      }
      return complaintObj;
    });

    res.json({
      count: complaints.length,
      complaints: complaintsWithUrgency
    });

  } catch (error) {
    console.error('Error fetching institution complaints:', error);
    res.status(500).json({
      message: 'Error fetching complaints',
      error: error.message
    });
  }
};

// Update complaint deadline
exports.updateComplaintDeadline = async (req, res) => {
  try {
    const { id } = req.params;
    const { newDeadline } = req.body;

    // Validate new deadline
    if (!newDeadline || new Date(newDeadline) < new Date()) {
      return res.status(400).json({
        message: 'Invalid deadline. Deadline must be a future date'
      });
    }

    // Find complaint and ensure it belongs to this institution
    const complaint = await Complaint.findOne({
      _id: id,
      institutionId: req.user._id
    });

    if (!complaint) {
      return res.status(404).json({
        message: 'Complaint not found or you do not have permission to update it'
      });
    }

    complaint.resolutionDeadline = new Date(newDeadline);
    await complaint.save();

    res.json({
      message: 'Complaint deadline updated successfully',
      complaint
    });

  } catch (error) {
    console.error('Error updating complaint deadline:', error);
    res.status(500).json({
      message: 'Error updating complaint deadline',
      error: error.message
    });
  }
};

// Update complaint status
exports.updateComplaintStatus = async (req, res) => {
  try {
    const { complaintId } = req.params;
    const { status, resolutionDeadline } = req.body;

    // Ensure user is an institution
    if (req.user.role !== 'institution') {
      return res.status(403).json({
        message: 'Only institutions can update complaint status'
      });
    }

    const complaint = await Complaint.findById(complaintId)
      .populate('citizenId', 'email phone');

    if (!complaint) {
      return res.status(404).json({ message: 'Complaint not found' });
    }

    // Ensure the institution owns this complaint
    if (complaint.institutionId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: 'Not authorized to update this complaint'
      });
    }

    // Update status
    complaint.status = status;
    
    let notificationErrors = [];

    // If status is RESOLVED, set resolution date and send notification
    if (status === 'RESOLVED') {
      complaint.resolutionDate = new Date();
      
      try {
        await sendNotification('RESOLVED', {
          email: complaint.citizenId.email,
          phone: complaint.citizenId.phone
        }, {
          complaintId: complaint._id,
          trackingNumber: complaint.trackingNumber
        });
      } catch (error) {
        notificationErrors.push({ type: 'resolved', error: error.message });
      }
    }

    // If deadline is being updated, send notification
    if (resolutionDeadline) {
      complaint.resolutionDeadline = resolutionDeadline;
      
      try {
        await sendNotification('DEADLINE_SET', {
          email: complaint.citizenId.email,
          phone: complaint.citizenId.phone
        }, {
          complaintId: complaint._id,
          trackingNumber: complaint.trackingNumber,
          deadline: resolutionDeadline
        });
      } catch (error) {
        notificationErrors.push({ type: 'deadline', error: error.message });
      }
    }

    await complaint.save();

    res.json({
      message: 'Complaint updated successfully',
      complaint,
      notificationStatus: {
        success: notificationErrors.length === 0,
        errors: notificationErrors.length > 0 ? notificationErrors : undefined
      }
    });
  } catch (error) {
    console.error('Error updating complaint:', error);
    res.status(500).json({
      message: 'Error updating complaint',
      error: error.message
    });
  }
};

// Forward complaint to district department
exports.forwardComplaint = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { complaintId } = req.params;
    const { departmentId, forwardingNote } = req.body;

    // Find the complaint and ensure it belongs to this institution
    const complaint = await Complaint.findOne({
      _id: complaintId,
      institutionId: req.user._id
    });

    if (!complaint) {
      return res.status(404).json({
        message: 'Complaint not found or you do not have permission to forward it'
      });
    }

    // Find the department
    const department = await DistrictDepartment.findById(departmentId);
    if (!department) {
      return res.status(404).json({
        message: 'District department not found'
      });
    }

    // Ensure department is in the same district as the complaint
    if (department.district !== complaint.district) {
      return res.status(400).json({
        message: 'Department must be in the same district as the complaint'
      });
    }

    // Create forwarding record
    const forwardingRecord = new ForwardingRecord({
      complaintId: complaint._id,
      fromInstitutionId: req.user._id,
      toDepartmentId: department._id,
      forwardingNote
    });

    await forwardingRecord.save();

    // Update complaint's assigned department
    complaint.assignedDepartment = department._id;
    complaint.status = 'IN_PROGRESS';
    await complaint.save();

    // Send email notification
    try {
      await sendNotification('COMPLAINT_FORWARDED', {
        email: department.email,
        phone: department.phone
      }, {
        departmentName: department.name,
        complaintId: complaint._id,
        trackingNumber: complaint.trackingNumber,
        title: complaint.title,
        note: forwardingNote
      });
    } catch (emailError) {
      console.error('Error sending email notification:', emailError);
      // Continue execution even if email fails
    }

    // Populate response data
    await forwardingRecord
      .populate('fromInstitutionId', 'institutionName')
      .populate('toDepartmentId', 'name email');

    res.json({
      message: 'Complaint forwarded successfully',
      forwardingRecord,
      emailSent: true
    });

  } catch (error) {
    console.error('Error forwarding complaint:', error);
    res.status(500).json({
      message: 'Error forwarding complaint',
      error: error.message
    });
  }
};

// Get forwarding history for a complaint
exports.getForwardingHistory = async (req, res) => {
  try {
    const { complaintId } = req.params;

    // Ensure the user has access to this complaint
    const complaint = await Complaint.findOne({
      _id: complaintId,
      $or: [
        { institutionId: req.user._id },
        { citizenId: req.user._id }
      ]
    });

    if (!complaint) {
      return res.status(404).json({
        message: 'Complaint not found or you do not have permission to view it'
      });
    }

    const forwardingHistory = await ForwardingRecord.find({ complaintId })
      .populate('fromInstitutionId', 'institutionName')
      .populate('toDepartmentId', 'name')
      .sort({ forwardedAt: -1 });

    res.json(forwardingHistory);

  } catch (error) {
    console.error('Error fetching forwarding history:', error);
    res.status(500).json({
      message: 'Error fetching forwarding history',
      error: error.message
    });
  }
}; 